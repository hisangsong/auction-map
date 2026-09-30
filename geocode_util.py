# -*- coding: utf-8 -*-
"""주소→좌표 캐시 지오코딩(카카오 REST). 빌드 시 물건에 lat/lng를 미리 넣어
프런트엔드가 실시간 변환 없이 지도를 즉시 그리게 한다.

- 캐시: geocache.json (주소 -> [lat,lng] 또는 null). 매일 증분만 신규 호출.
- 키: 환경변수 KAKAO_REST_KEY (GitHub Actions Secret). 없으면 아무 것도 안 함.
"""
import os
import json
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import requests

CACHE_PATH = Path(__file__).parent / "geocache.json"
KEY = os.environ.get("KAKAO_REST_KEY")
_KW_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
_ADDR_URL = "https://dapi.kakao.com/v2/local/search/address.json"


def load_cache():
    if CACHE_PATH.exists():
        try:
            return json.load(open(CACHE_PATH, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache):
    json.dump(cache, open(CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False)


def _variants(q):
    q = (q or "").strip()
    parts = q.split()
    seen = []
    for cand in [q, " ".join(parts[:-1]) if len(parts) > 2 else None,
                 " ".join(parts[:3]) if len(parts) > 3 else None,
                 " ".join(parts[:2]) if len(parts) > 2 else None]:
        if cand and cand not in seen:
            seen.append(cand)
    return seen


def _one_req(url, query):
    try:
        r = requests.get(url, params={"query": query, "size": 1},
                         headers={"Authorization": "KakaoAK " + KEY}, timeout=10)
        if r.status_code == 200:
            docs = r.json().get("documents", [])
            if docs:
                return [float(docs[0]["y"]), float(docs[0]["x"])]
    except Exception:
        pass
    return None


def _geocode_one(q):
    variants = _variants(q)
    # 1) 주소 지오코딩(지번/도로명을 정확히 매칭 → 확대해도 번지에 핀이 맞음)
    for query in variants:
        v = _one_req(_ADDR_URL, query)
        if v:
            return v
    # 2) 키워드 검색 폴백(주소가 군더더기 포함 등으로 실패할 때)
    for query in variants:
        v = _one_req(_KW_URL, query)
        if v:
            return v
    return None


def geocode_items(items, addr_fn, max_new=40000, workers=8, refresh=False):
    """items 각 원소에 lat/lng를 채운다. 캐시에 있으면 재사용, 없으면 신규 호출(최대 max_new).

    refresh=True 면 캐시에 있어도 다시 지오코딩한다(주소검색 우선 방식으로 정밀 재적용).
    """
    if not KEY:
        print("KAKAO_REST_KEY 없음 - 좌표 프리스토어 건너뜀", flush=True)
        return 0
    cache = load_cache()
    todo = []
    for it in items:
        addr = addr_fn(it)
        if not addr:
            continue
        if not refresh and addr in cache:
            v = cache[addr]
            if v:
                it["lat"], it["lng"] = v[0], v[1]
        else:
            todo.append((it, addr))
    # refresh 시 같은 주소가 여러 물건에 걸쳐 중복될 수 있으니 주소 단위로 1회만 호출.
    if refresh:
        seen, uniq = set(), []
        for it, addr in todo:
            if addr not in seen:
                seen.add(addr); uniq.append((it, addr))
        todo = uniq
    todo = todo[:max_new]
    total_new = len(todo)
    lock = threading.Lock()
    done = [0]

    def work(pair):
        it, addr = pair
        v = _geocode_one(addr)
        with lock:
            cache[addr] = v
            done[0] += 1
            # 진행 중에도 주기적으로 캐시를 저장한다. CI가 타임아웃으로 중간에
            # 죽어도 여기까지의 지오코딩 결과가 보존돼, 다음 실행이 캐시로 이어받는다.
            if done[0] % 500 == 0:
                save_cache(cache)
                print(f"  지오코딩 진행 {done[0]}/{total_new} (캐시 {len(cache)})", flush=True)
        if v:
            it["lat"], it["lng"] = v[0], v[1]

    if todo:
        print(f"지오코딩 시작: 신규 대상 {total_new}건 (동시 {workers})", flush=True)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(work, todo))
        save_cache(cache)
    # 최종적으로 캐시값을 모든 물건에 반영(같은 주소 중복·refresh 갱신분 포함).
    for it in items:
        addr = addr_fn(it)
        v = cache.get(addr) if addr else None
        if v:
            it["lat"], it["lng"] = v[0], v[1]
    print(f"지오코딩: 신규 {done[0]}건 / 캐시 {len(cache)}건", flush=True)
    return done[0]
