# -*- coding: utf-8 -*-
"""
캠코 온비드(OnBid) 부동산 공매물건을 전국 수집해 onbid.json 으로 저장한다.
지도 앱(index.html)이 api/onbid.js 대신 이 파일을 읽어 공매를 표시한다(없으면 라이브 폴백).

- 최신 온비드 API: https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
- 인증키: 환경변수 DATA_GO_KR_KEY (GitHub Actions Secret / 로컬 환경변수). Decoding 키.
- 키가 없으면 아무것도 하지 않고 정상 종료한다(워크플로에서 스킵).

사용법: DATA_GO_KR_KEY=... python build_onbid.py
"""

import os
import re
import json
import time
import datetime
from pathlib import Path
from urllib.parse import quote

import requests

KEY = os.environ.get("DATA_GO_KR_KEY")
DIR = Path(__file__).parent
OUT = DIR / "onbid.json"
BASE = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
CAR_BASE = "https://apis.data.go.kr/B010003/OnbidCarListSrvc2/getCarCltrList2"
ASSET_BASE = "https://apis.data.go.kr/B010003/OnbidMvastListSrvc2/getMvastCltrList2"
ROWS = 1000
MAX_PAGES = 80  # 안전 상한 (최대 8만건)

SIDO_NORM = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전라북도": "전북특별자치도",
    "전남": "전라남도", "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
}
VALID_SIDO = set(SIDO_NORM.values())


def norm_sido(s):
    s = (s or "").strip()
    return SIDO_NORM.get(s, s)


def num(v):
    d = re.sub(r"[^0-9]", "", str(v if v is not None else ""))
    return int(d) if d else 0


def ymd(v):
    s = str(v if v is not None else "")
    if len(s) < 8 or s.startswith("2999"):
        return ""
    return s[0:4] + "-" + s[4:6] + "-" + s[6:8]


def fetch_list(base, page):
    url = (base + "?serviceKey=" + quote(KEY, safe="") +
           "&numOfRows=" + str(ROWS) + "&pageNo=" + str(page) +
           "&resultType=json&prptDivCd=0007,0005&pvctTrgtYn=N")
    r = requests.get(url, timeout=40)
    r.raise_for_status()
    return r.json()


def fetch_page(page):
    return fetch_list(BASE, page)


def to_movable(o, gubun):
    """동산·자동차(위치 없음) 물건 매핑."""
    nm = (o.get("onbidCltrNm") or "").strip()
    if not nm:
        return None
    감정가 = num(o.get("apslEvlAmt"))
    최저가 = num(o.get("lowstBidPrcIndctCont")) or num(o.get("frstBidPrc"))
    try:
        율 = round(float(o.get("apslPrcCtrsLowstBidRto"))) if o.get("apslPrcCtrsLowstBidRto") not in (None, "") \
            else (round(최저가 / 감정가 * 100) if 감정가 else 0)
    except (TypeError, ValueError):
        율 = round(최저가 / 감정가 * 100) if 감정가 else 0
    cltr = str(o.get("cltrMngNo") or "")
    is_car = gubun == "자동차"
    it = {
        "구분": gubun, "사건번호": cltr,
        "법원": o.get("orgNm") or o.get("rqstOrgNm") or "캠코 온비드",
        "소재지": nm,
        "보관지": " ".join(x for x in [o.get("lctnSdnm"), o.get("lctnSggnm"), o.get("lctnEmdNm")] if x).strip(),
        "시도": norm_sido(o.get("lctnSdnm")),
        "시군구": (o.get("lctnSggnm") or "").strip(),
        "읍면동": (o.get("lctnEmdNm") or "").strip(),
        "용도": o.get("cltrUsgMclsCtgrNm") or o.get("cltrUsgSclsCtgrNm") or o.get("cltrUsgLclsCtgrNm") or gubun,
        "감정가": 감정가, "최저가": 최저가, "최저가율": 율, "유찰": num(o.get("usbdNft")),
        "매각기일": ymd(o.get("cltrBidEndDt")),
        "입찰시작": ymd(o.get("cltrBidBgngDt")), "입찰종료": ymd(o.get("cltrBidEndDt")),
        "처분방식": o.get("dspsMthodNm") or "", "상태": o.get("bidMthodNm") or "",
        "면적구조": "", "비고": o.get("prptDivNm") or "", "물건명": nm,
        "고유번호": ("ONBIDCAR-" if is_car else "ONBIDAST-") + cltr + "-" + str(o.get("pbctCdtnNo") or ""),
        "onbid": {"cltrMngNo": cltr, "pbctCdtnNo": o.get("pbctCdtnNo"),
                  "onbidCltrno": o.get("onbidCltrno"), "onbidPbancNo": o.get("onbidPbancNo"), "pbctNo": o.get("pbctNo")},
    }
    if is_car:
        it["주행거리"] = num(o.get("drvDstc"))
        it["연식"] = o.get("yrmdl") or ""
        it["차량번호"] = o.get("vhrnoCont") or ""
        it["연료"] = o.get("fuelCont") or ""
        it["변속기"] = o.get("pnsNm") or ""
        it["이미지"] = o.get("thnlImgUrlAdr") or ""
    return it


def collect_movable(base, gubun):
    raw = []
    total = None
    for page in range(1, MAX_PAGES + 1):
        arr, tot = extract(fetch_list(base, page))
        if total is None:
            total = tot
            print(f"{gubun} 총 {total}건", flush=True)
        if not arr:
            break
        raw.extend(arr)
        if total and len(raw) >= total:
            break
        time.sleep(0.3)
    byno = {}
    for o in raw:
        it = to_movable(o, gubun)
        if not it:
            continue
        k = it["사건번호"] or it["고유번호"]
        cur = byno.get(k)
        if not cur:
            byno[k] = it
            continue
        keep = cur
        if it["매각기일"] and not cur["매각기일"]:
            keep = it
        elif (bool(it["매각기일"]) == bool(cur["매각기일"])) and it["최저가"] > 0 and (cur["최저가"] <= 0 or it["최저가"] < cur["최저가"]):
            keep = it
        byno[k] = keep
    return list(byno.values())


def extract(data):
    body = (data.get("response", {}) or {}).get("body") or data.get("body") or {}
    items = body.get("items", [])
    arr = items.get("item") if isinstance(items, dict) else items
    if isinstance(arr, dict):
        arr = [arr]
    if not isinstance(arr, list):
        arr = []
    try:
        total = int(body.get("totalCount") or 0)
    except (TypeError, ValueError):
        total = 0
    return arr, total


def to_item(o):
    시도 = norm_sido(o.get("lctnSdnm"))
    if 시도 not in VALID_SIDO:
        return None
    소재지 = (o.get("onbidCltrNm") or " ".join(
        x for x in [o.get("lctnSdnm"), o.get("lctnSggnm"), o.get("lctnEmdNm")] if x)).strip()
    if not 소재지:
        return None
    감정가 = num(o.get("apslEvlAmt"))
    최저가 = num(o.get("lowstBidPrcIndctCont")) or num(o.get("frstBidPrc"))
    try:
        율 = round(float(o.get("apslPrcCtrsLowstBidRto"))) if o.get("apslPrcCtrsLowstBidRto") not in (None, "") \
            else (round(최저가 / 감정가 * 100) if 감정가 else 0)
    except (TypeError, ValueError):
        율 = round(최저가 / 감정가 * 100) if 감정가 else 0
    cltr = str(o.get("cltrMngNo") or "")
    return {
        "구분": "공매",
        "사건번호": cltr,
        "법원": o.get("orgNm") or o.get("rqstOrgNm") or "캠코 온비드",
        "소재지": 소재지,
        "시도": 시도,
        "시군구": (o.get("lctnSggnm") or "").strip(),
        "읍면동": (o.get("lctnEmdNm") or "").strip(),
        "용도": o.get("cltrUsgSclsCtgrNm") or o.get("cltrUsgMclsCtgrNm") or o.get("cltrUsgLclsCtgrNm") or "기타",
        "감정가": 감정가,
        "최저가": 최저가,
        "최저가율": 율,
        "유찰": num(o.get("usbdNft")),
        "매각기일": ymd(o.get("cltrBidEndDt")),
        "입찰시작": ymd(o.get("cltrBidBgngDt")),
        "입찰종료": ymd(o.get("cltrBidEndDt")),
        "처분방식": o.get("dspsMthodNm") or "",
        "상태": o.get("bidMthodNm") or "",
        "면적구조": "",
        "비고": o.get("prptDivNm") or "",
        "물건명": o.get("onbidCltrNm") or "",
        "고유번호": "ONBID-" + cltr + "-" + str(o.get("pbctCdtnNo") or ""),
        "onbid": {
            "cltrMngNo": cltr, "pbctCdtnNo": o.get("pbctCdtnNo"),
            "onbidCltrno": o.get("onbidCltrno"), "onbidPbancNo": o.get("onbidPbancNo"), "pbctNo": o.get("pbctNo"),
        },
    }


def main():
    if not KEY:
        print("DATA_GO_KR_KEY 없음 - 공매 수집 건너뜀")
        return

    raw = []
    total = None
    for page in range(1, MAX_PAGES + 1):
        data = fetch_page(page)
        arr, tot = extract(data)
        if total is None:
            total = tot
            print(f"공매 총 {total}건 (페이지 {ROWS}건씩)", flush=True)
        if not arr:
            break
        raw.extend(arr)
        if total and len(raw) >= total:
            break
        time.sleep(0.3)

    # 물건관리번호 기준 중복(회차) 제거: 실제 매각기일 우선, 그다음 최저가 낮은 회차
    by_no = {}
    for o in raw:
        it = to_item(o)
        if not it:
            continue
        k = it["사건번호"] or it["고유번호"]
        cur = by_no.get(k)
        if not cur:
            by_no[k] = it
            continue
        keep = cur
        if it["매각기일"] and not cur["매각기일"]:
            keep = it
        elif (bool(it["매각기일"]) == bool(cur["매각기일"])) and it["최저가"] > 0 and (cur["최저가"] <= 0 or it["최저가"] < cur["최저가"]):
            keep = it
        by_no[k] = keep

    items = list(by_no.values())
    today = datetime.date.today().strftime("%Y-%m-%d")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"items": items, "updatedAt": today}, f, ensure_ascii=False)
    print(f"완료: 공매(부동산) {len(items)}건 저장 -> {OUT}", flush=True)

    # 동산·자동차(위치 없음) 저장본 생성
    for base, gubun, fname in [(ASSET_BASE, "동산", "asset.json"), (CAR_BASE, "자동차", "car.json")]:
        try:
            mv = collect_movable(base, gubun)
            with open(DIR / fname, "w", encoding="utf-8") as f:
                json.dump({"items": mv, "updatedAt": today}, f, ensure_ascii=False)
            print(f"완료: {gubun} {len(mv)}건 저장 -> {fname}", flush=True)
        except Exception as e:
            print(f"{gubun} 수집 실패(건너뜀): {e}", flush=True)


if __name__ == "__main__":
    main()
