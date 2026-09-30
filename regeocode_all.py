# -*- coding: utf-8 -*-
"""기존 저장본(data/onbid/car/asset.json)의 좌표를 '주소검색 우선' 방식으로 정밀 재적용.

프리스토어 초기값은 카카오 키워드검색 기반이라 확대하면 번지 오차가 보였다.
이 스크립트는 geocode_items(refresh=True) 로 캐시를 무시하고 주소검색(address.json)
우선으로 다시 지오코딩해, 지번/도로명에 핀이 정확히 맞도록 좌표를 갱신한다.

- 캐시(geocache.json)도 새 값으로 덮어써진다(증분 저장으로 중단돼도 진행분 보존).
- KAKAO_REST_KEY 필요. 없으면 아무것도 하지 않는다.
- 동시성: 환경변수 GEO_WORKERS(기본 8).

사용법: KAKAO_REST_KEY=... python regeocode_all.py
"""

import os
import json
from pathlib import Path

from geocode_util import geocode_items

DIR = Path(__file__).parent
WORKERS = int(os.environ.get("GEO_WORKERS", "8"))

# (파일, 주소 추출 함수) — 동산·자동차는 보관지 우선
TASKS = [
    ("data.json", lambda it: it.get("소재지")),
    ("onbid.json", lambda it: it.get("소재지")),
    ("asset.json", lambda it: it.get("보관지") or it.get("소재지")),
    ("car.json", lambda it: it.get("보관지") or it.get("소재지")),
]


def load(fname):
    p = DIR / fname
    if not p.exists():
        return None
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception as e:
        print(f"{fname} 로드 실패: {e}", flush=True)
        return None


def save(fname, data):
    json.dump(data, open(DIR / fname, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))


def main():
    if not os.environ.get("KAKAO_REST_KEY"):
        print("KAKAO_REST_KEY 없음 - 정밀 재지오코딩 건너뜀", flush=True)
        return
    for fname, addr_fn in TASKS:
        d = load(fname)
        if not d:
            print(f"{fname} 없음 - 건너뜀", flush=True)
            continue
        items = d.get("items", [])
        if not items:
            print(f"{fname} 물건 없음 - 건너뜀", flush=True)
            continue
        print(f"=== {fname}: {len(items)}건 정밀 재지오코딩 시작 ===", flush=True)
        geocode_items(items, addr_fn, workers=WORKERS, refresh=True)
        w = sum(1 for it in items if it.get("lat") is not None)
        save(fname, d)
        print(f"{fname} 완료: 좌표 {w}/{len(items)}", flush=True)


if __name__ == "__main__":
    main()
