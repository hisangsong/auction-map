// Vercel Serverless Function: AI 권리분석
//
// 물건의 등기부상 권리관계 요약(사건상세)과 현황조사서(점유관계·임차인 현황)를
// 대법원 법원경매정보 공개 API에서 가져와 AI에게 넘기고, 말소기준권리·인수여부·
// 임차인 대항력 등을 정리한 권리분석 결과를 받아 돌려준다.
//
// 무료 AI를 폴백 체인으로 사용한다:
//   1) Google Gemini (GEMINI_API_KEY, https://aistudio.google.com/apikey)
//   2) Groq (GROQ_API_KEY, https://console.groq.com/keys) - Llama 무료
// 앞의 것이 한도초과(429)·오류·키없음이면 다음 것으로 자동 전환한다.
//
// POST /api/analyze  body: { cortOfcCd, saNo, dspslGdsSeq, 사건번호, ... 물건필드 }

import { getSessionCookie, fetchCaseDetail, fetchCurstExmndc } from "./_lib/court.js";

const GEMINI_MODEL = "gemini-flash-latest";
const GROQ_MODEL = "llama-3.3-70b-versatile";

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

// --- 무료 AI 제공자들 (각자 성공 시 텍스트 반환, 실패 시 throw) ---
async function callGemini(facts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 없음");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: facts }] }],
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error?.message || `Gemini 오류 (${r.status})`);
  const text = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini 응답이 비어있음");
  return { analysis: text, provider: "Gemini", model: GEMINI_MODEL };
}

async function callGroq(facts) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY 없음");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: facts },
      ],
      temperature: 0.3,
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error?.message || `Groq 오류 (${r.status})`);
  const text = (body.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Groq 응답이 비어있음");
  return { analysis: text, provider: "Groq", model: GROQ_MODEL };
}

// 시도 순서: Gemini → Groq (앞의 것이 실패/한도초과면 다음으로)
const PROVIDERS = [callGemini, callGroq];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    res.status(500).json({
      error: "AI 키가 없습니다. Vercel 환경변수에 GEMINI_API_KEY 또는 GROQ_API_KEY 중 하나 이상을 추가하세요 (둘 다 무료).",
    });
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
    try { caseDetail = await fetchCaseDetail(cookie, { cortOfcCd, csNo, dspslGdsSeq }); } catch {}
    let curst = null;
    try { curst = await fetchCurstExmndc(cookie, { cortOfcCd, csNo }); } catch {}

    const factsText = buildFactsText(item, caseDetail, curst);

    const errors = [];
    for (const provider of PROVIDERS) {
      try {
        const out = await provider(factsText);
        res.status(200).json({ analysis: out.analysis, provider: out.provider, model: out.model, facts: factsText });
        return;
      } catch (e) {
        errors.push(String(e && e.message ? e.message : e));
      }
    }
    res.status(502).json({ error: "AI 분석 실패 (모든 제공자 오류): " + errors.join(" / ") });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
