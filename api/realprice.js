// 국토교통부 아파트 매매 실거래가 API 프록시 (시세 비교용)
// 인증키는 Vercel 환경변수 DATA_GO_KR_KEY(온비드와 공유). 국토부 "아파트 매매 실거래가"
// 활용신청이 되어 있어야 동작한다(같은 키). 활용신청 안 되어 있으면 API_ERROR 반환.
// GET /api/realprice?lawd=11680&ymd=202608   (lawd=법정동 앞 5자리, ymd=계약년월)

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) { res.status(200).json({ error: "NO_KEY", message: "DATA_GO_KR_KEY 미설정" }); return; }
  const lawd = String(req.query.lawd || "");
  const ymd = String(req.query.ymd || "");
  if (!/^\d{5}$/.test(lawd) || !/^\d{6}$/.test(ymd)) { res.status(200).json({ error: "BAD_PARAMS" }); return; }

  const url = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev" +
    "?serviceKey=" + encodeURIComponent(key) + "&LAWD_CD=" + lawd + "&DEAL_YMD=" + ymd +
    "&numOfRows=300&pageNo=1";
  try {
    const r = await fetch(url);
    const xml = await r.text();
    const err = xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) || xml.match(/<errMsg>([\s\S]*?)<\/errMsg>/);
    if (!xml.includes("<item>") && err) { res.status(200).json({ error: "API_ERROR", message: err[1].trim() }); return; }
    const pick = (b, t) => { const m = b.match(new RegExp("<" + t + ">\\s*([\\s\\S]*?)\\s*</" + t + ">")); return m ? m[1].trim() : ""; };
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const b = m[1];
      return {
        아파트: pick(b, ["aptNm"]),
        법정동: pick(b, ["umdNm"]),
        거래금액: parseInt((pick(b, ["dealAmount"]) || "0").replace(/[^0-9]/g, ""), 10), // 만원
        전용면적: parseFloat(pick(b, ["excluUseAr"])) || 0,
        층: pick(b, ["floor"]),
        년: pick(b, ["dealYear"]), 월: pick(b, ["dealMonth"]), 일: pick(b, ["dealDay"]),
      };
    });
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
