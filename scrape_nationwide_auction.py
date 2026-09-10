# -*- coding: utf-8 -*-
"""
대한민국 법원 법원경매정보(courtauction.go.kr) - 전국 부동산 경매 물건 수집

scrape_seoul_auction.py 와 동일한 공개 JSON API(searchControllerMain.on)를 사용하되,
소재지(시/도) 조건을 비워 전국 전체를 조회한다.

주의:
- 전국 대상이라 물건 수가 2만건 이상으로 많아 페이지 요청도 그만큼 많다.
  (요청 간 딜레이가 있어 전체 수집에 다소 시간이 걸린다.)
- 사이트 특성상 매각기일이 오늘~2주 후까지인 공고중 물건만 조회 가능.
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

PAGE_SIZE = 40
REQUEST_DELAY_SEC = 0.6

# 시/도 코드를 비우면(전체) 전국 대상으로 조회된다.
SIDO_CODE = ""

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
            "rprsAdongSdCd": SIDO_CODE,
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
    session.get(SEARCH_PAGE_URL, timeout=15)

    all_rows: list[dict] = []
    page_no = 1
    total_cnt = None

    while True:
        payload = build_payload(page_no, bid_bgng_ymd, bid_end_ymd)
        resp = session.post(API_URL, json=payload, timeout=30)
        resp.raise_for_status()
        body = resp.json()

        if body.get("status") != 200:
            raise RuntimeError(f"API 오류: {body}")

        data = body.get("data", {})
        if total_cnt is None:
            total_cnt = int(data.get("dma_pageInfo", {}).get("totalCnt") or 0)
            print(f"총 물건 수: {total_cnt}건 (예상 페이지: {(total_cnt + PAGE_SIZE - 1)//PAGE_SIZE})", flush=True)

        rows = data.get("dlt_srchResult") or []
        all_rows.extend(rows)
        if page_no % 10 == 0 or not rows:
            print(f"  {page_no}페이지 수집 완료 (누적 {len(all_rows)}/{total_cnt}건)", flush=True)

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
    out_path = Path(__file__).parent / "전국_법원경매물건.xlsx"

    print("전국 법원경매 물건 조회를 시작합니다...", flush=True)
    rows = fetch_all()

    if not rows:
        print("조회된 물건이 없습니다.")
        sys.exit(0)

    df = to_dataframe(rows)
    df.to_excel(out_path, index=False, engine="openpyxl")
    print(f"완료: {len(df)}건을 저장했습니다 -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
