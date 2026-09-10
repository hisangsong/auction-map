# -*- coding: utf-8 -*-
"""
전국 법원경매물건 지도(index.html)가 읽는 data.json 을 만든다.

scrape_nationwide_auction.py 의 fetch_all() 을 그대로 재사용해 대법원 법원경매정보
공개 API에서 전국 부동산 경매 물건을 수집한 뒤, 지도 앱이 쓰는 스키마로 변환해
data.json 으로 저장한다.

사용법:
    python build_data.py
"""

import json
import re
import datetime
from pathlib import Path

from scrape_nationwide_auction import fetch_all

OUT_PATH = Path(__file__).parent / "data.json"

# 시/도 명칭이 개편되면서(2023 강원, 2024 전북) 옛 이름과 새 이름이 데이터에 섞여
# 나온다. 지도 필터에서는 하나로 합쳐서 보여준다.
SIDO_ALIASES = {
    "강원도": "강원특별자치도",
    "전라북도": "전북특별자치도",
}


def to_int(v):
    try:
        if v in (None, ""):
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


def to_date_str(ymd):
    if not ymd:
        return ""
    try:
        d = datetime.datetime.strptime(ymd, "%Y%m%d")
        return d.strftime("%Y-%m-%d")
    except ValueError:
        return ymd


# 차량/선박/광업권 등 동산 물건은 "소재지"가 실제 주소가 아니라
# "사용본거지 : ...", "선적항 : ...", "광구소재지 : ..." 같은 자유서식 라벨
# 텍스트라서 시도/시군구가 구조화된 주소로 취급될 수 없다. 지도는 부동산
# 주소 기반이므로 이런 물건은 제외한다.
NON_ADDRESS_LABEL = re.compile(r"^[가-힣]{1,8}\s*:")


def transform(rows: list[dict]) -> list[dict]:
    items = []
    for row in rows:
        printSt = (row.get("printSt") or "").strip()
        if NON_ADDRESS_LABEL.match(printSt):
            continue
        sido = SIDO_ALIASES.get(row.get("hjguSido", ""), row.get("hjguSido", ""))
        items.append({
            "사건번호": row.get("srnSaNo", ""),
            "법원": row.get("jiwonNm", ""),
            "소재지": printSt,
            "용도": row.get("dspslUsgNm", ""),
            "감정가": to_int(row.get("gamevalAmt")),
            "최저가": to_int(row.get("minmaePrice")),
            "최저가율": to_int(row.get("notifyMinmaePriceRate1")),
            "유찰": to_int(row.get("yuchalCnt")) or 0,
            "매각기일": to_date_str(row.get("maeGiil")),
            "면적구조": (row.get("pjbBuldList") or "").strip(),
            "비고": (row.get("mulBigo") or "").strip(),
            "시도": sido,
            "시군구": row.get("hjguSigu", ""),
            "읍면동": row.get("hjguDong", ""),
            "고유번호": row.get("docid", ""),
        })
    return items


def build_sido_gu_index(items: list[dict]):
    gu_by_sido: dict[str, set] = {}
    for it in items:
        sido, gu = it["시도"], it["시군구"]
        if not sido or not gu:
            continue
        gu_by_sido.setdefault(sido, set()).add(gu)

    sido_list = sorted(gu_by_sido.keys())
    # 서울을 기본값으로 보여주기 위해 목록 맨 앞으로 이동
    if "서울특별시" in sido_list:
        sido_list.remove("서울특별시")
        sido_list.insert(0, "서울특별시")

    gu_by_sido_sorted = {sido: sorted(gu_by_sido[sido]) for sido in sido_list}
    return sido_list, gu_by_sido_sorted


def main():
    print("전국 법원경매 물건 수집을 시작합니다 (수 분 정도 걸립니다)...", flush=True)
    rows = fetch_all()

    items = transform(rows)
    sido_list, gu_by_sido = build_sido_gu_index(items)

    data = {
        "sido": sido_list,
        "guBySido": gu_by_sido,
        "items": items,
        "updatedAt": datetime.date.today().isoformat(),
    }

    OUT_PATH.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"완료: {len(items)}건 -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
