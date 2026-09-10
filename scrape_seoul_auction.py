# -*- coding: utf-8 -*-
"""
대한민국 법원 법원경매정보(courtauction.go.kr) - 서울특별시 전체 부동산 경매 물건 수집

법원경매정보 홈페이지의 '물건상세검색' 화면이 내부적으로 호출하는 공개 JSON API
(searchControllerMain.on)를 그대로 호출하여 데이터를 가져온 뒤 Excel로 저장한다.
로그인/공인인증 없이 접근 가능한 공개 조회 API이며, 사이트의 저작권 보호정책상
공공저작물은 출처 표시 하에 자유이용이 가능하다. (저작권법 제24조의2)

주의:
- 이 사이트는 "매각기일이 2주 후까지인" 공고중 물건만 조회를 지원한다.
  (사이트 안내문구: "검색되는 물건은 매각기일이 현재 날짜 이후인 물건으로,
   기일입찰인 경우 2주 후 매각기일까지... 검색 가능합니다.")
- 서버에 부담을 주지 않기 위해 페이지 요청 사이에 딜레이를 둔다.
"""

import sys
import time
import datetime
from pathlib import Path

import requests
import pandas as pd

BASE_URL = "https://www.courtauction.go.kr"
SEARCH_PAGE_URL = f"{BASE_URL}/pgj/index.on?w2xPath=%2Fpgj%2Fui%2Fpgj100%2FPGJ151F00.xml"
API_URL = f"{BASE_URL}/pgj/pgjsearch/searchControllerMain.on"

PAGE_SIZE = 40          # 서버가 허용하는 페이지 크기 (100은 400 오류, 40은 정상 동작 확인)
REQUEST_DELAY_SEC = 0.8  # 요청 간 딜레이 (서버 부담 최소화)

# 시/도 코드: 서울특별시 = "11" (사이트 콤보박스에서 확인)
SIDO_CODE_SEOUL = "11"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ),
    "Referer": SEARCH_PAGE_URL,
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "submissionid": "mf_wfm_mainFrame_sbm_selectGdsDtlSrch",
    "sc-userid": "SYSTEM",
}

COLUMN_MAP = {
    "srnSaNo": "사건번호",
    "jiwonNm": "법원",
    "jpDeptNm": "담당계",
    "printSt": "소재지",
    "dspslUsgNm": "용도",
    "gamevalAmt": "감정평가액",
    "minmaePrice": "최저매각가격",
    "notifyMinmaePriceRate1": "최저매각가율(%)",
    "yuchalCnt": "유찰횟수",
    "maeGiil": "매각기일",
    "maeHh1": "매각시각",
    "maePlace": "매각장소",
    "mulBigo": "비고",
    "pjbBuldList": "면적/구조",
    "hjguSido": "시도",
    "hjguSigu": "시군구",
    "hjguDong": "읍면동",
    "tel": "담당계 전화번호",
    "docid": "물건고유번호",
}


def build_payload(page_no: int, bid_bgng_ymd: str, bid_end_ymd: str) -> dict:
    return {
        "dma_pageInfo": {
            "pageNo": page_no,
            "pageSize": PAGE_SIZE,
            "bfPageNo": "",
            "startRowNo": "",
            "totalCnt": "",
            "totalYn": "Y",
            "groupTotalCount": "",
        },
        "dma_srchGdsDtlSrchInfo": {
            "rletDspslSpcCondCd": "",
            "bidDvsCd": "000331",
            "mvprpRletDvsCd": "00031R",
            "cortAuctnSrchCondCd": "0004601",
            "rprsAdongSdCd": SIDO_CODE_SEOUL,
            "rprsAdongSggCd": "",
            "rprsAdongEmdCd": "",
            "rdnmSdCd": "",
            "rdnmSggCd": "",
            "rdnmNo": "",
            "mvprpDspslPlcAdongSdCd": "",
            "mvprpDspslPlcAdongSggCd": "",
            "mvprpDspslPlcAdongEmdCd": "",
            "rdDspslPlcAdongSdCd": "",
            "rdDspslPlcAdongSggCd": "",
            "rdDspslPlcAdongEmdCd": "",
            "cortOfcCd": "",
            "jdbnCd": "",
            "execrOfcDvsCd": "",
            "lclDspslGdsLstUsgCd": "",
            "mclDspslGdsLstUsgCd": "",
            "sclDspslGdsLstUsgCd": "",
            "cortAuctnMbrsId": "",
            "aeeEvlAmtMin": "",
            "aeeEvlAmtMax": "",
            "lwsDspslPrcRateMin": "",
            "lwsDspslPrcRateMax": "",
            "flbdNcntMin": "",
            "flbdNcntMax": "",
            "objctArDtsMin": "",
            "objctArDtsMax": "",
            "mvprpArtclKndCd": "",
            "mvprpArtclNm": "",
            "mvprpAtchmPlcTypCd": "",
            "notifyLoc": "on",
            "lafjOrderBy": "",
            "pgmId": "PGJ151F01",
            "csNo": "",
            "cortStDvs": "2",
            "statNum": 1,
            "bidBgngYmd": bid_bgng_ymd,
            "bidEndYmd": bid_end_ymd,
            "dspslDxdyYmd": "",
            "fstDspslHm": "",
            "scndDspslHm": "",
            "thrdDspslHm": "",
            "fothDspslHm": "",
            "dspslPlcNm": "",
            "lwsDspslPrcMin": "",
            "lwsDspslPrcMax": "",
            "grbxTypCd": "",
            "gdsVendNm": "",
            "fuelKndCd": "",
            "carMdyrMax": "",
            "carMdyrMin": "",
            "carMdlNm": "",
            "sideDvsCd": "",
        },
    }


def fetch_all() -> list[dict]:
    today = datetime.date.today()
    bid_bgng_ymd = today.strftime("%Y%m%d")
    bid_end_ymd = (today + datetime.timedelta(days=14)).strftime("%Y%m%d")

    session = requests.Session()
    session.headers.update(HEADERS)

    # WebSquare 세션 쿠키 확보를 위해 검색 화면을 한 번 방문한다.
    session.get(SEARCH_PAGE_URL, timeout=15)

    all_rows: list[dict] = []
    page_no = 1
    total_cnt = None

    while True:
        payload = build_payload(page_no, bid_bgng_ymd, bid_end_ymd)
        resp = session.post(API_URL, json=payload, timeout=20)
        resp.raise_for_status()
        body = resp.json()

        if body.get("status") != 200:
            raise RuntimeError(f"API 오류: {body}")

        data = body.get("data", {})
        if total_cnt is None:
            total_cnt = int(data.get("dma_pageInfo", {}).get("totalCnt") or 0)
            print(f"총 물건 수: {total_cnt}건")

        rows = data.get("dlt_srchResult") or []
        all_rows.extend(rows)
        print(f"  {page_no}페이지 수집 완료 ({len(rows)}건, 누적 {len(all_rows)}건)")

        if not rows or len(all_rows) >= total_cnt:
            break

        page_no += 1
        time.sleep(REQUEST_DELAY_SEC)

    return all_rows


def to_dataframe(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)

    for code_col in ("gamevalAmt", "minmaePrice"):
        if code_col in df.columns:
            df[code_col] = pd.to_numeric(df[code_col], errors="coerce")

    for date_col in ("maeGiil",):
        if date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], format="%Y%m%d", errors="coerce")

    keep_cols = [c for c in COLUMN_MAP if c in df.columns]
    df = df[keep_cols].rename(columns=COLUMN_MAP)
    return df


def main():
    out_path = Path(__file__).parent / "서울시_법원경매물건.xlsx"

    print("서울특별시 전체 법원경매 물건 조회를 시작합니다...")
    rows = fetch_all()

    if not rows:
        print("조회된 물건이 없습니다.")
        sys.exit(0)

    df = to_dataframe(rows)
    df.to_excel(out_path, index=False, engine="openpyxl")
    print(f"완료: {len(df)}건을 저장했습니다 -> {out_path}")


if __name__ == "__main__":
    main()
