// Vercel Serverless Function: 매각물건명세서 / 현황조사서 / 감정평가서 프록시
//
// 대법원 법원경매정보(courtauction.go.kr)가 물건상세 화면에서 각 문서 버튼을
// 누를 때 호출하는 것과 동일한 공개 JSON API를 서버에서 대신 호출한다.
// 브라우저에서 직접 호출하면 CORS로 막히기 때문에 이 프록시가 필요하다.
//
// GET /api/docs?type=maegak|curst|aee&cortOfcCd=B000210&saNo=20240130002501
//               &csNo=2024타경2501&dspslGdsSeq=1&maeGiil=2026-09-10&cortNm=서울중앙지방법원

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

module.exports = async (req, res) => {
  const { type, cortOfcCd, saNo, csNo, dspslGdsSeq, maeGiil, cortNm } = req.query;

  if (!type || !cortOfcCd || !saNo || !csNo) {
    res.status(400).json({ error: "missing required params" });
    return;
  }
  const seq = dspslGdsSeq || "1";
  const today = new Date();
  const bidBgngYmd = ymd(today);
  const bidEndYmd = ymd(new Date(today.getTime() + 14 * 86400000));
  const dspslDxdyYmd = (maeGiil || "").replace(/-/g, "");

  try {
    const cookie = await getSessionCookie();

    if (type === "curst") {
      const r = await postOn(
        "/pgj/pgj15B/selectCurstExmndc.on",
        { dma_srchCurstExmn: { cortOfcCd, csNo, auctnInfOriginDvsCd: "2", ordTsCnt: "" } },
        cookie,
        { submissionid: "mf_wfm_mainFrame_curstExmndcPopUp_wframe_sbm_selectCurstExmn" }
      );
      if (r.status !== 200) {
        res.status(404).json({ error: r.message || "현황조사서를 찾을 수 없습니다." });
        return;
      }
      res.status(200).json({ data: r.data });
      return;
    }

    if (type === "aee") {
      const r = await postOn(
        "/pgj/pgj15B/selectAeeWevlInfo.on",
        {
          dma_srchAeeWevl: {
            cortOfcCd,
            cortSptNm: cortNm || "",
            csNo,
            auctnInfOriginDvsCd: "4",
            dspslDxdyYmd,
            pgmId: "PGJ15BP03",
            ordTsCnt: "",
          },
        },
        cookie,
        { submissionid: "mf_wfm_mainFrame_aeeWevlPopUp_wframe_sbm_selectAeeWevlInfo" }
      );
      if (r.status !== 200) {
        res.status(404).json({ error: r.message || "감정평가서를 찾을 수 없습니다." });
        return;
      }
      const info = r.data?.dma_ordTsIndvdAeeWevlInf;
      if (!info?.aeeWevlNo) {
        res.status(404).json({ error: "감정평가서 정보가 없습니다." });
        return;
      }
      const cortNo = cortOfcCd.replace(/^B/, "");
      const url = `https://ca.kapanet.or.kr/view/${cortNo}/${saNo}/${info.ordTsCnt}/${info.aeeWevlNo}/${info.wrtYmd}`;
      res.status(200).json({ url });
      return;
    }

    if (type === "maegak") {
      const r1 = await postOn(
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
              bidBgngYmd,
              bidEndYmd,
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

      const info = r1.data?.dma_result?.dspslGdsDxdyInfo;
      if (!info?.dspslGdsSpcfcEcdocId) {
        res.status(404).json({ error: "매각물건명세서 정보가 없습니다." });
        return;
      }

      const r2 = await postOn(
        "/pgj/pgj15B/insertDspslGdsSpecArtcWdrwInf.on",
        {
          dma_dspslGdsSpecLog: {
            cortOfcCd,
            csNo: saNo,
            dspslGdsSeq: Number(seq),
            orvParam: info.orvParam,
            dspslGdsSpcfcEcdocId: info.dspslGdsSpcfcEcdocId,
            cortAuctnMbrsId: "NONUSER",
            docFlag: "1",
            dspslDxdyPbancEcdocId: "",
          },
        },
        cookie,
        { submissionid: "mf_wfm_mainFrame_sbm_insertDspslGdsSpecLogInfo", "sc-pgmid": "PGJ15BM01" }
      );

      const spec = r2.data?.dma_dspslSpcfcInfo;
      if (!spec?.url || !spec?.encParam) {
        res.status(404).json({ error: "매각물건명세서 링크를 만들지 못했습니다." });
        return;
      }

      const paramData = Buffer.from(
        JSON.stringify({ encParam: decodeURIComponent(spec.encParam), pspTkn: "NA", pspSid: "NA" })
      ).toString("base64");
      const url = `${spec.url}?paramData=${encodeURIComponent(paramData)}`;
      res.status(200).json({ url });
      return;
    }

    res.status(400).json({ error: "unknown type" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
