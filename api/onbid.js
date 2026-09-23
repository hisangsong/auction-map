// 캠코 온비드(OnBid) 공매물건 API를 대신 호출하는 서버 함수.
// - 인증키는 코드가 아니라 Vercel 환경변수(DATA_GO_KR_KEY)에서 읽는다.
// - 온비드 XML을 지도 앱(index.html)이 쓰는 아이템 스키마(경매와 동일 필드)로 변환한다.
// 호출 예: /api/onbid?rows=1000   (debug=1 이면 원본 XML 일부 반환)

const ONBID_URL =
  "http://openapi.onbid.co.kr/openapi/services/ThingInfoInquireSvc/getUnifyUsageCltr";

// 소재지 첫 단어 → 시/도(정식명칭) 정규화
const SIDO_NORM = {
  "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
  "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
  "세종특별자치시": "세종특별자치시",
  "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
  "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전라북도": "전북특별자치도",
  "전남": "전라남도", "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도",
};
const VALID_SIDO = new Set(Object.values(SIDO_NORM));

function parseRegion(addr) {
  const toks = (addr || "").trim().split(/\s+/);
  let 시도 = toks[0] || "";
  시도 = SIDO_NORM[시도] || 시도;
  const 시군구 = toks[1] || "";
  return { 시도, 시군구 };
}

export default async function handler(req, res) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    res.status(200).json({ error: "NO_KEY", message: "Vercel 환경변수 DATA_GO_KR_KEY가 설정되지 않았습니다." });
    return;
  }
  const rows = String(req.query.rows || "1000");
  const page = String(req.query.page || "1");
  const url = ONBID_URL + "?serviceKey=" + encodeURIComponent(key) +
    "&numOfRows=" + rows + "&pageNo=" + page;

  try {
    const r = await fetch(url);
    const xml = await r.text();
    if (req.query.debug) { res.status(200).json({ debug: true, sample: xml.slice(0, 2000) }); return; }

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
    const ymd = (s) => (!s || s.length < 8) ? "" : s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8);

    const items = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const b = m[1];
      const 소재지 = pick(b, ["LDNM_ADRS", "NMRD_ADRS", "ADRS"]);
      if (!소재지) continue;
      const { 시도, 시군구 } = parseRegion(소재지);
      if (!VALID_SIDO.has(시도)) continue; // 주소가 아닌 물건(차량 '사용본거지' 등) 제외

      const 감정가 = num(pick(b, ["APSL_ASES_AMT"]));
      const 최저가 = num(pick(b, ["MIN_BID_PRC"]));
      const CLTR_NO = pick(b, ["CLTR_NO"]);
      const PBCT_NO = pick(b, ["PBCT_NO"]);
      items.push({
        구분: "공매",
        사건번호: pick(b, ["CLTR_MNMT_NO", "PLNM_NO"]) || (CLTR_NO + "-" + PBCT_NO),
        법원: pick(b, ["ORG_NM", "DPSL_MTD_NM"]) || "캠코 온비드",
        소재지, 시도, 시군구, 읍면동: "",
        용도: pick(b, ["CTGR_FULL_NM", "CTGR_NM"]) || "기타",
        감정가, 최저가,
        최저가율: 감정가 > 0 ? Math.round(최저가 / 감정가 * 100) : (최저가 ? 100 : 0),
        유찰: 0,
        매각기일: ymd(pick(b, ["PBCT_CLS_DTM"])),
        면적구조: "", 비고: pick(b, ["DPSL_MTD_NM"]),
        처분방식: pick(b, ["DPSL_MTD_NM"]),
        상태: pick(b, ["PBCT_CLTR_STAT_NM"]),
        입찰시작: ymd(pick(b, ["PBCT_BEGN_DTM"])),
        입찰종료: ymd(pick(b, ["PBCT_CLS_DTM"])),
        물건명: pick(b, ["CLTR_NM"]),
        고유번호: "ONBID-" + CLTR_NO + "-" + PBCT_NO,
        onbid: {
          CLTR_NO, PBCT_NO,
          CLTR_HSTR_NO: pick(b, ["CLTR_HSTR_NO"]),
          PLNM_NO: pick(b, ["PLNM_NO"]),
        },
      });
    }

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json({ items });
  } catch (e) {
    res.status(200).json({ error: "FETCH_FAIL", message: String(e) });
  }
}
