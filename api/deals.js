// 캠코 온비드(OnBid) 공매물건 API를 대신 호출해주는 "서버 함수"
// - 인증키는 코드가 아니라 Vercel 환경변수(DATA_GO_KR_KEY)에서 읽습니다.
// - 온비드가 돌려주는 XML을 깔끔한 JSON으로 바꿔 앱에 전달합니다.
// 호출 예: /api/deals?rows=200   (debug=1 을 붙이면 원본 XML 일부를 확인)

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    res.status(200).json({ error: "NO_KEY", message: "Vercel 환경변수 DATA_GO_KR_KEY가 설정되지 않았습니다." });
    return;
  }

  const rows = String(req.query.rows || "200");
  const page = String(req.query.page || "1");

  const url =
    "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc/getUnifyUsageCltr" +
    "?serviceKey=" + encodeURIComponent(key) +
    "&numOfRows=" + rows +
    "&pageNo=" + page;

  try {
    const r = await fetch(url);
    const xml = await r.text();

    if (req.query.debug) { res.status(200).json({ debug: true, sample: xml.slice(0, 2000) }); return; }

    // 인증/서비스 오류 감지
    const err = xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) ||
                xml.match(/<errMsg>([\s\S]*?)<\/errMsg>/);
    if (!xml.includes("<item>") && err) {
      res.status(200).json({ error: "API_ERROR", message: err[1].trim(), raw: xml.slice(0, 300) });
      return;
    }

    const pick = (body, tags) => {
      for (const t of tags) {
        const m = body.match(new RegExp("<" + t + ">\\s*([\\s\\S]*?)\\s*</" + t + ">"));
        if (m && m[1].trim()) return m[1].trim();
      }
      return "";
    };
    const num = (s) => parseInt((s || "").replace(/[^0-9]/g, ""), 10) || 0;

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const b = m[1];
      return {
        물건명:   pick(b, ["CLTR_NM"]),
        소재지:   pick(b, ["LDNM_ADRS", "NMRD_ADRS", "ADRS"]),
        용도:     pick(b, ["CTGR_FULL_NM", "CTGR_NM"]),
        감정가:   num(pick(b, ["APSL_ASES_AMT"])),   // 원
        최저입찰가: num(pick(b, ["MIN_BID_PRC"])),     // 원
        입찰시작: pick(b, ["PBCT_BEGN_DTM"]),
        입찰종료: pick(b, ["PBCT_CLS_DTM"]),
        처분방식: pick(b, ["DPSL_MTD_NM", "DPSL_MTD_CD"]),
        상태:     pick(b, ["PBCT_CLTR_STAT_NM", "PBCT_CLTR_STAT_CD"]),
        물건관리번호: pick(b, ["CLTR_NO"]),
        공매번호: pick(b, ["PBCT_NO"]),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
