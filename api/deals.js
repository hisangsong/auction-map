// 국토교통부 아파트 매매 실거래가 API를 대신 호출해주는 "서버 함수"
// - 비밀키(서비스키)는 코드에 넣지 않고 Vercel 환경변수(DATA_GO_KR_KEY)에서 읽습니다.
// - 국토부가 돌려주는 XML을 깔끔한 JSON으로 바꿔서 앱에 전달합니다.
// 호출 예: /api/deals?lawd=11680&ymd=202607

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    res.status(200).json({ error: "NO_KEY", message: "Vercel 환경변수 DATA_GO_KR_KEY가 설정되지 않았습니다." });
    return;
  }

  const lawd = String(req.query.lawd || "11680"); // 지역코드(법정동 앞 5자리)
  const ymd = String(req.query.ymd || "");         // 계약년월(YYYYMM)

  const url =
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev" +
    "?serviceKey=" + encodeURIComponent(key) +
    "&LAWD_CD=" + lawd +
    "&DEAL_YMD=" + ymd +
    "&pageNo=1&numOfRows=100&_type=xml";

  try {
    const r = await fetch(url);
    const xml = await r.text();

    // 국토부가 에러(키 오류 등)를 XML로 돌려주는 경우 감지
    const errMatch = xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) ||
                     xml.match(/<errMsg>([\s\S]*?)<\/errMsg>/) ||
                     xml.match(/<cmmMsgHeader>[\s\S]*?<returnReasonCode>([\s\S]*?)<\/returnReasonCode>/);
    const okHeader = xml.includes("<resultCode>000</resultCode>") || xml.includes("<item>");
    if (!okHeader && errMatch) {
      res.status(200).json({ error: "API_ERROR", message: errMatch[1].trim(), raw: xml.slice(0, 300) });
      return;
    }

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const body = m[1];
      const g = (tag) => {
        const mm = body.match(new RegExp("<" + tag + ">\\s*([\\s\\S]*?)\\s*</" + tag + ">"));
        return mm ? mm[1].trim() : "";
      };
      return {
        아파트: g("aptNm"),
        법정동: g("umdNm"),
        지번: g("jibun"),
        도로명: g("roadNm"),
        거래금액: parseInt((g("dealAmount") || "0").replace(/[^0-9]/g, ""), 10), // 만원
        전용면적: g("excluUseAr"),
        층: g("floor"),
        건축년도: g("buildYear"),
        년: g("dealYear"), 월: g("dealMonth"), 일: g("dealDay"),
      };
    });

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
