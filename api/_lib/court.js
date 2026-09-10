// 대법원 법원경매정보(courtauction.go.kr) 공개 API 호출용 공통 헬퍼.
// api/docs.js, api/analyze.js 가 공유한다.

const BASE = "https://www.courtauction.go.kr";
const SEARCH_PAGE = `${BASE}/pgj/index.on?w2xPath=%2Fpgj%2Fui%2Fpgj100%2FPGJ151F00.xml`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function collectCookie(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  const raw = res.headers.get("set-cookie") || "";
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getSessionCookie() {
  const res = await fetch(SEARCH_PAGE, { headers: { "User-Agent": UA } });
  return collectCookie(res);
}

async function postOn(path, body, cookie, extraHeaders) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: SEARCH_PAGE,
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
      "sc-userid": "NONUSER",
      Cookie: cookie,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`unexpected response from ${path}: ${text.slice(0, 200)}`);
  }
}

// 사건 상세(등기부상 권리관계 요약 등)와 현황조사서(점유관계, 임차인 현황)를
// 한 번에 가져오는 헬퍼. 둘 다 여러 기능(문서조회, AI 권리분석)에서 재사용된다.
async function fetchCaseDetail(cookie, { cortOfcCd, csNo, dspslGdsSeq }) {
  const seq = dspslGdsSeq || "1";
  const today = new Date();
  const r = await postOn(
    "/pgj/pgj15B/selectAuctnCsSrchRslt.on",
    {
      dma_srchGdsDtlSrch: {
        csNo,
        cortOfcCd,
        dspslGdsSeq: String(seq),
        pgmId: "PGJ151F01",
        srchInfo: {
          cortOfcCd,
          pgmId: "PGJ151F01",
          csNo,
          cortStDvs: "1",
          statNum: 1,
          bidBgngYmd: ymd(today),
          bidEndYmd: ymd(new Date(today.getTime() + 14 * 86400000)),
          sideDvsCd: "2",
          srchRowIndex: 0,
          menuNm: "물건상세검색",
          rletDspslSpcCondCd: "",
          bidDvsCd: "000331",
          mvprpRletDvsCd: "00031R",
          cortAuctnSrchCondCd: "0004601",
          rprsAdongSdCd: "",
          rprsAdongSggCd: "",
          rprsAdongEmdCd: "",
          rdnmSdCd: "",
          rdnmSggCd: "",
          rdnmNo: "",
          mvprpDspslPlcAdongSdCd: "",
          mvprpDspslPlcAdongSggCd: "",
          mvprpDspslPlcAdongEmdCd: "",
          rdDspslPlcAdongSdCd: "",
          rdDspslPlcAdongSggCd: "",
          rdDspslPlcAdongEmdCd: "",
          jdbnCd: "",
          execrOfcDvsCd: "",
          lclDspslGdsLstUsgCd: "",
          mclDspslGdsLstUsgCd: "",
          sclDspslGdsLstUsgCd: "",
          cortAuctnMbrsId: "",
          aeeEvlAmtMin: "",
          aeeEvlAmtMax: "",
          lwsDspslPrcRateMin: "",
          lwsDspslPrcRateMax: "",
          flbdNcntMin: "",
          flbdNcntMax: "",
          objctArDtsMin: "",
          objctArDtsMax: "",
          mvprpArtclKndCd: "",
          mvprpArtclNm: "",
          mvprpAtchmPlcTypCd: "",
          notifyLoc: "off",
          lafjOrderBy: "",
          dspslDxdyYmd: "",
          fstDspslHm: "",
          scndDspslHm: "",
          thrdDspslHm: "",
          fothDspslHm: "",
          dspslPlcNm: "",
          lwsDspslPrcMin: "",
          lwsDspslPrcMax: "",
          grbxTypCd: "",
          gdsVendNm: "",
          fuelKndCd: "",
          carMdyrMax: "",
          carMdyrMin: "",
          carMdlNm: "",
        },
      },
    },
    cookie,
    { submissionid: "mf_wfm_mainFrame_sbm_selectGdsDtlSrchDtlInfo", "sc-pgmid": "PGJ15BM01" }
  );
  return r.data?.dma_result || {};
}

async function fetchCurstExmndc(cookie, { cortOfcCd, csNo }) {
  const r = await postOn(
    "/pgj/pgj15B/selectCurstExmndc.on",
    { dma_srchCurstExmn: { cortOfcCd, csNo, auctnInfOriginDvsCd: "2", ordTsCnt: "" } },
    cookie,
    { submissionid: "mf_wfm_mainFrame_curstExmndcPopUp_wframe_sbm_selectCurstExmn" }
  );
  if (r.status !== 200) return null;
  return r.data || null;
}

module.exports = {
  BASE,
  SEARCH_PAGE,
  UA,
  ymd,
  getSessionCookie,
  postOn,
  fetchCaseDetail,
  fetchCurstExmndc,
};
