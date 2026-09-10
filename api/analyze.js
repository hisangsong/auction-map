// Vercel Serverless Function: AI 권리분석
//
// 물건의 등기부상 권리관계 요약(사건상세)과 현황조사서(점유관계·임차인 현황)를
// 대법원 법원경매정보 공개 API에서 가져와 Claude에게 넘기고, 말소기준권리·인수여부·
// 임차인 대항력 등을 정리한 권리분석 결과를 받아 돌려준다.
//
// 필요 환경변수: ANTHROPIC_API_KEY (Vercel 프로젝트 설정 > Environment Variables 에 추가)
//
// POST /api/analyze
// body: { cortOfcCd, saNo, dspslGdsSeq, 사건번호, 법원, 소재지, 용도, 감정가, 최저가,
//         최저가율, 유찰, 매각기일, 면적구조, 비고 }

const Anthropic = require("@anthropic-ai/sdk");
const { getSessionCookie, fetchCaseDetail, fetchCurstExmndc } = require("./_lib/court");

const SYSTEM_PROMPT = `당신은 한국 법원경매 물건의 권리분석을 돕는 보조 도구입니다.
아래 제공되는 사건 정보(등기부상 권리관계 요약, 현황조사서상 점유관계·임차인 현황, 물건 기본정보)만을
근거로 권리분석을 작성하세요. 정보에 없는 내용은 추측하지 말고 "제공된 정보로는 판단할 수 없음"이라고
명시하세요.

다음 5개 항목으로, 한국어로, 간결하게 작성하세요:
1. 요약 의견 (한두 문장)
2. 말소기준권리 추정 (최선순위 설정일자 기준)
3. 매수인이 인수해야 할 수 있는 권리 (별도등기, 예고등기 등)
4. 임차인 대항력·배당 분석 (전입일자와 말소기준권리 날짜 선후관계, 배당요구 여부)
5. 주의사항 및 추가 확인이 필요한 사항

마지막 줄에 반드시 다음 문구를 그대로 포함하세요:
"⚠️ 이 분석은 AI가 공개된 정보만으로 생성한 참고 자료이며 법적 자문이 아닙니다. 입찰 전 매각물건명세서·감정평가서 원본과 등기사항전부증명서를 반드시 직접 확인하시기 바랍니다."`;

function buildFactsText(item, caseDetail, curst) {
  const dxdy = caseDetail?.dspslGdsDxdyInfo || {};
  const lines = [];

  lines.push("## 물건 기본정보");
  lines.push(`사건번호: ${item.사건번호 || "-"}`);
  lines.push(`법원: ${item.법원 || "-"}`);
  lines.push(`소재지: ${item.소재지 || "-"}`);
  lines.push(`용도: ${item.용도 || "-"}`);
  lines.push(`감정가: ${item.감정가 ?? "-"}원`);
  lines.push(`최저매각가: ${item.최저가 ?? "-"}원 (${item.최저가율 ?? "-"}%)`);
  lines.push(`유찰횟수: ${item.유찰 ?? 0}회`);
  lines.push(`매각기일: ${item.매각기일 || "-"}`);
  if (item.면적구조) lines.push(`면적/구조: ${item.면적구조}`);
  if (item.비고) lines.push(`비고: ${item.비고}`);

  lines.push("\n## 등기부상 권리관계 요약 (법원 제공)");
  lines.push(`최선순위 설정일자: ${dxdy.tprtyRnkHypthcStngDts || "정보 없음"}`);
  lines.push(`말소되지 않는 권리(별도등기 등): ${dxdy.ndstrcRghCtt || "없음/정보 없음"}`);
  lines.push(`물건 특기사항: ${dxdy.gdsSpcfcRmk || "없음"}`);
  lines.push(`배당요구종기: ${caseDetail?.dstrtDemnInfo?.[0]?.dstrtDemnLstprdYmd || "정보 없음"}`);

  lines.push("\n## 현황조사서 - 점유관계 및 임차인 현황");
  if (curst?.dlt_ordTsRlet?.length) {
    curst.dlt_ordTsRlet.forEach((o, i) => {
      lines.push(`(${i + 1}) 소재지: ${o.printSt || "-"}`);
      lines.push(`    점유관계: ${o.gdsPossCtt || "정보 없음"}`);
    });
  } else {
    lines.push("점유관계 정보 없음");
  }
  if (curst?.dlt_ordTsLserLtn?.length) {
    lines.push("\n임차인/점유자 목록:");
    curst.dlt_ordTsLserLtn.forEach((l, i) => {
      lines.push(
        `(${i + 1}) 점유인: ${l.intrpsNm || "-"}, 전입일자: ${l.mvinDtlCtt || "정보 없음"}, ` +
          `확정일자: ${l.rgstryCrtcpCfmtnCtt || "정보 없음"}, 용도: ${l.auctnLesUsgCd || "-"}`
      );
    });
  } else {
    lines.push("임차인/점유자 정보 없음 (무상 점유 또는 소유자 점유 가능성)");
  }

  return lines.join("\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res
      .status(500)
      .json({ error: "ANTHROPIC_API_KEY가 설정되어 있지 않습니다. Vercel 프로젝트의 Environment Variables에 추가해주세요." });
    return;
  }

  const item = req.body || {};
  const { cortOfcCd, saNo, dspslGdsSeq } = item;
  const csNo = item.사건번호;
  if (!cortOfcCd || !saNo || !csNo) {
    res.status(400).json({ error: "missing case identifiers" });
    return;
  }

  try {
    const cookie = await getSessionCookie();

    let caseDetail = {};
    try {
      caseDetail = await fetchCaseDetail(cookie, { cortOfcCd, csNo, dspslGdsSeq });
    } catch {
      // 사건상세를 못 가져와도 현황조사서만으로 부분 분석은 진행한다.
    }

    let curst = null;
    try {
      curst = await fetchCurstExmndc(cookie, { cortOfcCd, csNo });
    } catch {
      // 현황조사서가 없을 수도 있다 (조회 가능 기간이 아니거나 대상이 아닌 경우).
    }

    const factsText = buildFactsText(item, caseDetail, curst);

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: factsText }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    res.status(200).json({ analysis: text, facts: factsText });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
