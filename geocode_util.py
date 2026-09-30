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
_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"


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


def _geocode_one(q):
    for query in _variants(q):
        try:
            r = requests.get(_URL, params={"query": query, "size": 1},
                             headers={"Authorization": "KakaoAK " + KEY}, timeout=10)
            if r.status_code == 200:
                docs = r.json().get("documents", [])
                if docs:
                    return [float(docs[0]["y"]), float(docs[0]["x"])]
        except Exception:
            pass
    return None


def geocode_items(items, addr_fn, max_new=8000, workers=8):
    """items 각 원소에 lat/lng를 채운다. 캐시에 있으면 재사용, 없으면 신규 호출(최대 max_new)."""
    if not KEY:
        print("KAKAO_REST_KEY 없음 - 좌표 프리스토어 건너뜀", flush=True)
        return 0
    cache = load_cache()
    todo = []
    for it in items:
        addr = addr_fn(it)
        if not addr:
            continue
        if addr in cache:
            v = cache[addr]
            if v:
                it["lat"], it["lng"] = v[0], v[1]
        else:
            todo.append((it, addr))
    todo = todo[:max_new]
    lock = threading.Lock()
    done = [0]

    def work(pair):
        it, addr = pair
        v = _geocode_one(addr)
        with lock:
            cache[addr] = v
            done[0] += 1
        if v:
            it["lat"], it["lng"] = v[0], v[1]

    if todo:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(work, todo))
        save_cache(cache)
    print(f"지오코딩: 신규 {done[0]}건 / 캐시 {len(cache)}건", flush=True)
    return done[0]
