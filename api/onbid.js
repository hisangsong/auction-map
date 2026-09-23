// 캠코 온비드(OnBid) 부동산 공매물건 "목록" API를 대신 호출하는 서버 함수.
// - 최신(차세대) 온비드 API: https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2
// - 인증키는 코드가 아니라 Vercel 환경변수(DATA_GO_KR_KEY, Decoding키)에서 읽는다.
// - 결과(JSON)를 지도 앱(index.html)이 쓰는 아이템 스키마(경매와 동일 필드)로 변환한다.
// 호출 예: /api/onbid?rows=1000   (debug=1 이면 원본 응답 일부 반환)

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
  const url = BASE + "?serviceKey=" + encodeURIComponent(key) +
    "&numOfRows=" + rows + "&pageNo=" + page + "&resultType=json";

  try {
    const r = await fetch(url);
    const text = await r.text();
    if (req.query.debug) { res.status(200).json({ debug: true, status: r.status, sample: text.slice(0, 2000) }); return; }

    let j;
    try { j = JSON.parse(text); }
    catch (e) { res.status(200).json({ error: "PARSE_FAIL", message: text.slice(0, 300) }); return; }

    const header = j.response?.header || j.header || {};
    const body = j.response?.body || j.body || j;
    let arr = body?.items?.item ?? body?.items ?? [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];

    if (!arr.length && header.resultCode && !["00", "000", "0"].includes(String(header.resultCode))) {
      res.status(200).json({ error: "API_ERROR", code: header.resultCode, message: header.resultMsg || "온비드 API 오류" });
      return;
    }

    const num = (v) => { const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; };
    const ymd = (v) => { const s = String(v ?? ""); return s.length >= 8 ? s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8) : ""; };

    const items = arr.map((o) => {
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

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json({ items, total: body?.totalCount ?? items.length });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
