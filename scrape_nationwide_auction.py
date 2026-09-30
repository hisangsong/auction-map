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

import os
import sys
import time
import random
import datetime
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
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


# 동시에 여러 페이지를 받되, 스레드마다 별도 세션(쿠키)을 쓴다.
# 하나의 requests.Session 을 여러 스레드가 공유하면 안전하지 않기 때문.
_thread_local = threading.local()

# 페이지를 순차로 받으면 772페이지 × ~2.6초 ≈ 25분이 걸린다. 각 페이지 요청은
# pageNo 를 payload 에 담아 독립적이므로, 병렬로 나눠 받으면 몇 분으로 줄어든다.
# courtauction 의 부하/차단을 고려해 동시성은 보수적으로(기본 6) 둔다.
PAGE_WORKERS = int(os.environ.get("SCRAPE_WORKERS", "6"))


def _get_session() -> requests.Session:
    s = getattr(_thread_local, "session", None)
    if s is None:
        s = requests.Session()
        s.headers.update(HEADERS)
        try:
            s.get(SEARCH_PAGE_URL, timeout=20)  # 세션/쿠키 수립
        except Exception:
            pass
        _thread_local.session = s
    return s


def _fetch_page(page_no: int, bgng: str, end: str) -> list[dict]:
    """한 페이지를 재시도와 함께 받아 rows(list) 를 돌려준다. 실패하면 예외."""
    payload = build_payload(page_no, bgng, end)
    last_err = None
    for attempt in range(5):
        try:
            session = _get_session()
            resp = session.post(API_URL, json=payload, timeout=40)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            body = resp.json()
            if body.get("status") != 200:
                raise RuntimeError(f"API status={body.get('status')}")
            return body.get("data", {}).get("dlt_srchResult") or []
        except Exception as e:
            last_err = e
            print(f"  {page_no}페이지 재시도 {attempt + 1}/5 ({e})", flush=True)
            time.sleep(2 * (attempt + 1) + random.random())
            _thread_local.session = None  # 세션 재수립 유도
    raise RuntimeError(f"{page_no}페이지 조회 실패(재시도 초과): {last_err}")


def fetch_all() -> list[dict]:
    today = datetime.date.today()
    bgng = today.strftime("%Y%m%d")
    end = (today + datetime.timedelta(days=14)).strftime("%Y%m%d")

    # 1페이지: 전체 건수와 첫 결과를 먼저 확보한다.
    first_payload = build_payload(1, bgng, end)
    body = None
    last_err = None
    for attempt in range(5):
        try:
            resp = _get_session().post(API_URL, json=first_payload, timeout=40)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            body = resp.json()
            if body.get("status") != 200:
                raise RuntimeError(f"API status={body.get('status')}")
            break
        except Exception as e:
            last_err = e
            print(f"  1페이지 재시도 {attempt + 1}/5 ({e})", flush=True)
            time.sleep(3 * (attempt + 1))
            _thread_local.session = None
    if body is None:
        raise RuntimeError(f"1페이지 조회 실패(재시도 초과): {last_err}")

    data = body.get("data", {})
    total_cnt = int(data.get("dma_pageInfo", {}).get("totalCnt") or 0)
    total_pages = (total_cnt + PAGE_SIZE - 1) // PAGE_SIZE
    print(f"총 물건 수: {total_cnt}건 (예상 페이지: {total_pages}, 동시 {PAGE_WORKERS})", flush=True)

    all_rows: list[dict] = list(data.get("dlt_srchResult") or [])
    if total_pages <= 1:
        return all_rows

    # 2..N 페이지를 병렬로 수집한다. 순서는 무관.
    done = [1]
    failed: list[int] = []
    lock = threading.Lock()

    def work(p: int):
        try:
            rows = _fetch_page(p, bgng, end)
        except Exception as e:
            with lock:
                failed.append(p)
            print(f"  {p}페이지 최종 실패: {e}", flush=True)
            return
        with lock:
            all_rows.extend(rows)
            done[0] += 1
            if done[0] % 20 == 0:
                print(f"  진행 {done[0]}/{total_pages}페이지 (누적 {len(all_rows)}건)", flush=True)

    with ThreadPoolExecutor(max_workers=PAGE_WORKERS) as ex:
        list(ex.map(work, range(2, total_pages + 1)))

    # 실패한 페이지는 마지막에 순차로 한 번 더 시도(부하 완화).
    for p in failed:
        try:
            all_rows.extend(_fetch_page(p, bgng, end))
        except Exception as e:
            print(f"  {p}페이지 재시도도 실패(건너뜀): {e}", flush=True)

    print(f"수집 완료: {len(all_rows)}/{total_cnt}건", flush=True)
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
