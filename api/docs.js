// Vercel Serverless Function: 현황조사서 / 감정평가서 / 매각물건명세서 요약 프록시
//
// 대법원 법원경매정보(courtauction.go.kr)가 물건상세 화면에서 각 문서 버튼을
// 누를 때 호출하는 것과 동일한 공개 JSON API를 서버에서 대신 호출한다.
// 브라우저에서 직접 호출하면 CORS로 막히기 때문에 이 프록시가 필요하다.
//
// 매각물건명세서 "원본 PDF"는 여기서 열어줄 수 없다: 그 문서는 courtauction.go.kr
// 세션과 1:1로 묶인 서명 토큰(encParam)을 쓰는데, 그 토큰은 발급받은 바로 그 브라우저
// 세션에서만 유효하다 (README 참고). 대신 매각물건명세서를 구성하는 것과 동일한
// 공개 데이터(사건상세 selectAuctnCsSrchRslt.on + 현황조사서 selectCurstExmndc.on)를
// 모아 "요약" 형태로 즉시 보여준다 (type=maegak). 법원 발급 원본은 여전히 수동 안내로 연결한다.
//
// GET /api/docs?type=curst|aee|maegak&cortOfcCd=B000210&saNo=20240130002501
//               &csNo=2024타경2501&dspslGdsSeq=1&maeGiil=2026-09-10&cortNm=서울중앙지방법원

const { UA, getSessionCookie, postOn, fetchCaseDetail, fetchCurstExmndc } = require("./_lib/court");

module.exports = async (req, res) => {
  const { type, cortOfcCd, saNo, csNo, cortNm, maeGiil, dspslGdsSeq } = req.query;

  if (!type || !cortOfcCd || !saNo || !csNo) {
    res.status(400).json({ error: "missing required params" });
    return;
  }
  const dspslDxdyYmd = (maeGiil || "").replace(/-/g, "");

  try {
    const cookie = await getSessionCookie();

    if (type === "curst") {
      const curst = await fetchCurstExmndc(cookie, { cortOfcCd, csNo });
      if (!curst) {
        res.status(404).json({ error: "현황조사서를 찾을 수 없습니다." });
        return;
      }
      res.status(200).json({ data: curst });
      return;
    }

    if (type === "maegak") {
      let caseDetail = {};
      try {
        caseDetail = await fetchCaseDetail(cookie, { cortOfcCd, csNo, dspslGdsSeq: dspslGdsSeq || "1" });
      } catch {
        // 사건상세를 못 가져와도 현황조사서만으로 부분 요약은 보여준다.
      }
      const curst = await fetchCurstExmndc(cookie, { cortOfcCd, csNo });
      res.status(200).json({ caseDetail, curst });
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
      const viewUrl = `https://ca.kapanet.or.kr/view/${cortNo}/${saNo}/${info.ordTsCnt}/${info.aeeWevlNo}/${info.wrtYmd}`;

      // 이 뷰어 페이지는 Referer가 정확히 "https://www.courtauction.go.kr/" (origin만, 경로 없이)일
      // 때만 실제 PDF 경로를 <script>로 심어서 내려준다. 그 조건이 아니면 빈 iframe만 내려와
      // 화면이 하얗게 보인다. 브라우저의 window.open()은 우리 도메인을 Referer로 보내므로 여기서
      // 서버가 대신 올바른 Referer로 한 번 더 요청해 실제 PDF 경로를 뽑아낸다.
      // 주의: fetch()의 headers에 Referer를 직접 넣으면 "forbidden header"로 조용히 무시된다
      // (undici/브라우저 공통 스펙) - 반드시 referrer/referrerPolicy 옵션으로 지정해야 한다.
      const viewRes = await fetch(viewUrl, {
        referrer: "https://www.courtauction.go.kr/",
        referrerPolicy: "unsafe-url",
        headers: { "User-Agent": UA },
      });
      const viewHtml = await viewRes.text();
      const m = viewHtml.match(/\.src\s*=\s*'([^']+)'/);
      if (!m) {
        res.status(404).json({ error: "감정평가서 PDF 경로를 찾지 못했습니다." });
        return;
      }
      const pdfUrl = new URL(m[1], viewUrl).toString();
      res.status(200).json({ url: pdfUrl });
      return;
    }

    res.status(400).json({ error: "unknown type" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
