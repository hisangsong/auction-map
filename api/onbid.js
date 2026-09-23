// 캠코 온비드(OnBid) 부동산 공매물건 "목록" API를 대신 호출하는 서버 함수.
// 최신 온비드 API: https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2 (HTTPS/JSON)
// 인증키는 Vercel 환경변수(DATA_GO_KR_KEY, Decoding키)에서 읽는다.
// 전국 물건이 많아(7만+) 시/도 단위로 조회한다: /api/onbid?sido=서울특별시  (debug=1 이면 원본 일부)

const BASE = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";

const SIDO_NORM = {
  "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
  "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
  "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
  "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전라북도": "전북특별자치도",
  "전남": "전라남도", "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
};
const normSido = (s) => SIDO_NORM[(s || "").trim()] || (s || "").trim();

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    res.status(200).json({ error: "NO_KEY", message: "Vercel 환경변수 DATA_GO_KR_KEY가 설정되지 않았습니다." });
    return;
  }
  const rows = String(req.query.rows || "1000");
  const page = String(req.query.page || "1");
  const prpt = String(req.query.prpt || "0007,0005"); // 압류재산+기타일반재산 (필수)
  const pvct = String(req.query.pvct || "N");          // 경쟁입찰 진행/예정 (필수)
  const sido = String(req.query.sido || "");
  const gu = String(req.query.gu || "");

  let url = BASE + "?serviceKey=" + encodeURIComponent(key) +
    "&numOfRows=" + rows + "&pageNo=" + page + "&resultType=json" +
    "&prptDivCd=" + encodeURIComponent(prpt) + "&pvctTrgtYn=" + pvct;
  if (sido) url += "&lctnSdnm=" + encodeURIComponent(sido);
  if (gu) url += "&lctnSggnm=" + encodeURIComponent(gu);

  try {
    const r = await fetch(url);
    const text = await r.text();
    if (req.query.debug) { res.status(200).json({ debug: true, status: r.status, sample: text.slice(0, 2000) }); return; }

    let j;
    try { j = JSON.parse(text); }
    catch (e) { res.status(200).json({ error: "PARSE_FAIL", message: text.slice(0, 300) }); return; }

    const cmm = j.OpenAPI_ServiceResponse?.cmmMsgHeader || j.response?.cmmMsgHeader;
    if (cmm && (cmm.errMsg || cmm.returnAuthMsg)) {
      res.status(200).json({ error: "API_ERROR", code: cmm.returnReasonCode, message: (cmm.returnAuthMsg || cmm.errMsg) });
      return;
    }

    const header = j.response?.header || j.header || {};
    const body = j.response?.body || j.body || j;
    let arr = body?.items?.item ?? body?.items ?? [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    if (!arr.length && header.resultCode && !["00", "000", "0"].includes(String(header.resultCode))) {
      res.status(200).json({ error: "API_ERROR", code: header.resultCode, message: header.resultMsg || "온비드 API 오류" });
      return;
    }

    const num = (v) => { const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
    const ymd = (v) => { const s = String(v ?? ""); if (s.length < 8 || s.startsWith("2999")) return ""; return s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8); };

    const raw = arr.map((o) => {
      const 시도 = normSido(o.lctnSdnm);
      const 시군구 = (o.lctnSggnm || "").trim();
      const 소재지 = (o.onbidCltrNm || [o.lctnSdnm, o.lctnSggnm, o.lctnEmdNm].filter(Boolean).join(" ")).trim();
      const 감정가 = num(o.apslEvlAmt);
      const 최저가 = num(o.lowstBidPrcIndctCont) || num(o.frstBidPrc);
      const 율 = o.apslPrcCtrsLowstBidRto != null && o.apslPrcCtrsLowstBidRto !== ""
        ? Math.round(parseFloat(o.apslPrcCtrsLowstBidRto))
        : (감정가 > 0 ? Math.round(최저가 / 감정가 * 100) : 0);
      return {
        구분: "공매",
        사건번호: o.cltrMngNo || "",
        법원: o.orgNm || o.rqstOrgNm || "캠코 온비드",
        소재지, 시도, 시군구, 읍면동: (o.lctnEmdNm || "").trim(),
        용도: o.cltrUsgSclsCtgrNm || o.cltrUsgMclsCtgrNm || o.cltrUsgLclsCtgrNm || "기타",
        감정가, 최저가, 최저가율: 율, 유찰: num(o.usbdNft),
        매각기일: ymd(o.cltrBidEndDt),
        입찰시작: ymd(o.cltrBidBgngDt), 입찰종료: ymd(o.cltrBidEndDt),
        처분방식: o.dspsMthodNm || "", 상태: o.bidMthodNm || "",
        면적구조: "", 비고: o.prptDivNm || "",
        물건명: o.onbidCltrNm || "",
        고유번호: "ONBID-" + (o.cltrMngNo || "") + "-" + (o.pbctCdtnNo || ""),
        onbid: {
          cltrMngNo: o.cltrMngNo, pbctCdtnNo: o.pbctCdtnNo,
          onbidCltrno: o.onbidCltrno, onbidPbancNo: o.onbidPbancNo, pbctNo: o.pbctNo,
        },
      };
    }).filter(it => it.소재지 && it.시도);

    // 같은 물건(물건관리번호)이 회차별로 여러 건 → 1건으로 합침.
    // 실제 입찰일이 있는 건 우선, 그다음 최저가가 낮은(=진행된 회차) 건을 남긴다.
    const byNo = new Map();
    for (const it of raw) {
      const k = it.사건번호 || it.고유번호;
      const cur = byNo.get(k);
      if (!cur) { byNo.set(k, it); continue; }
      let keep = cur;
      if (it.매각기일 && !cur.매각기일) keep = it;
      else if (!!it.매각기일 === !!cur.매각기일 && it.최저가 > 0 && (cur.최저가 <= 0 || it.최저가 < cur.최저가)) keep = it;
      byNo.set(k, keep);
    }
    const items = [...byNo.values()];

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json({ items, total: body?.totalCount ?? items.length });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
