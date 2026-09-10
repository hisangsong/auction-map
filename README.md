# 전국 법원경매물건 지도 ⚖️

전국 법원경매 물건을 지도에 표시하는 웹 앱입니다.

- **지도**: 카카오맵 (소재지 → 좌표 자동 변환)
- **데이터**: `data.json` (대법원 법원경매정보 실데이터)
- **기능**: 시/도 → 시군구 2단계 선택, 용도별 필터, 유찰횟수별 필터(최초/1회유찰/2회유찰/3회이상),
  물건 마커(최저매각가), 목록, 상세정보, 카카오 로드뷰, 현황조사서·감정평가서 바로 보기,
  AI 권리분석

## 데이터 갱신 방법

```
python build_data.py
```

`scrape_nationwide_auction.py` 가 대법원 법원경매정보(courtauction.go.kr) 공개 API에서
전국 부동산 경매 물건을 전부 수집하고, `build_data.py` 가 그 결과를 지도 앱이 읽는
`data.json` 스키마로 변환해 저장합니다. (전국 대상이라 물건 수가 많아 수 분 정도 걸립니다.)

`data.json` 을 새로 만든 뒤 git commit/push 하면 됩니다.

필요한 패키지: `requests`, `pandas`, `openpyxl` (`pip install requests pandas openpyxl`)

### 서울만 필요할 때

`scrape_nationwide_auction.py` 대신 시/도 코드를 특정 지역으로 고정한
`scrape_seoul_auction.py` 를 쓰면 서울시 물건만 담은 엑셀을 받을 수 있습니다.
(단, `build_data.py` 는 전국 스크립트를 기준으로 만들어져 있으므로 서울만 갱신하려면
`SIDO_CODE` 를 바꾸거나 별도 변환이 필요합니다.)

## data.json 스키마

```json
{
  "sido": ["서울특별시", "부산광역시", ...],
  "guBySido": { "서울특별시": ["강남구", "종로구", ...], ... },
  "items": [
    {
      "사건번호": "2024타경2501", "법원": "서울중앙지방법원",
      "소재지": "서울특별시 중구 퇴계로 72 1층110호 (회현동1가,리더스뷰남산)",
      "용도": "다세대", "감정가": 700000000, "최저가": 448000000,
      "최저가율": 51, "유찰": 3, "매각기일": "2026-09-10",
      "면적구조": "철근콘크리트구조 46.06㎡", "비고": "",
      "시도": "서울특별시", "시군구": "중구", "읍면동": "회현동1가",
      "고유번호": "B0002102024013000250111",
      "cortOfcCd": "B000210", "saNo": "20240130002501", "dspslGdsSeq": "1"
    }
  ],
  "updatedAt": "2026-09-10"
}
```

`cortOfcCd`/`saNo`/`dspslGdsSeq`는 화면에 표시하진 않지만 `/api/docs` 가 대법원
법원경매정보 API를 호출할 때 사건을 식별하는 데 쓰인다.

## 현황조사서 · 감정평가서 (자동 표시)

`/api/docs` (Vercel 서버리스 함수, `api/docs.js`)가 대법원 법원경매정보 사이트가 각 문서
버튼을 누를 때 호출하는 것과 동일한 공개 JSON API를 서버에서 대신 호출한다
(브라우저에서 바로 호출하면 CORS로 막힌다):

- **현황조사서**: `selectCurstExmndc.on` 이 돌려주는 구조화된 JSON(점유관계, 임대차현황 등)을
  그대로 화면에 표로 렌더링한다.
- **감정평가서**: `selectAeeWevlInfo.on` 응답의 `aeeWevlNo`/`wrtYmd` 로 한국감정평가사협회
  (ca.kapanet.or.kr)의 뷰어 페이지 URL을 만든 뒤, 그 페이지를 서버가 대신 한 번 더 요청해서
  (`referrer: "https://www.courtauction.go.kr/"`) 실제 PDF 경로를 뽑아내고, 그 직접 PDF 링크를
  새 창으로 연다. 이 뷰어는 Referer가 정확히 그 origin일 때만 PDF 경로를 내려주는데, `fetch()`의
  `headers.Referer`는 "forbidden header"라 조용히 무시되므로 반드시 `referrer`/`referrerPolicy`
  옵션으로 지정해야 한다 (`api/docs.js` 참고).

두 문서 모두 매각기일 기준 1~2주 전부터만 조회 가능하다는 법원 사이트의 제약이 그대로 적용된다
(그 밖의 기간이면 "문서를 찾을 수 없습니다" 메시지가 뜬다).

## 매각물건명세서 (자동 표시 불가 - 수동 안내)

매각물건명세서는 법원 문서뷰어(ecfs.scourt.go.kr)가 발급하는 서명 토큰(`encParam`)이
**그 토큰을 발급받은 courtauction.go.kr 브라우저 세션에만 유효**하다. 우리 서버가 대신
발급받아도, 방문자의 브라우저가 그 링크를 열면 세션이 다르므로 "로그인 안내" 화면만 뜬다
(Referer 문제가 아니라 세션 바인딩 문제 - 실제로 같은 브라우저의 courtauction.go.kr 탭에서
`window.open`으로 열어도 우리 서버가 만든 토큰이면 똑같이 로그인 화면이 뜨는 것을 확인했다).
그래서 이 버튼은 사건번호를 클립보드에 복사하고 공식 검색 화면을 새 창으로 열어, 사용자가
그 자리에서 검색 후 원본 문서 버튼을 누르도록 안내하는 방식으로 되돌렸다.

## AI 권리분석

상세 패널의 "🔍 권리분석 (AI)" 버튼은 `/api/analyze` (Vercel 서버리스 함수, `api/analyze.js`)를
호출한다. 이 함수는 사건상세(`selectAuctnCsSrchRslt.on`, 최선순위 설정일자·별도등기 등 말소되지
않는 권리)와 현황조사서(`selectCurstExmndc.on`, 점유관계·임차인 전입일자)를 대법원 공개 API에서
가져와 Claude(`claude-opus-5`)에게 넘기고, 말소기준권리·인수여부·임차인 대항력 등을 정리한
분석 결과를 돌려받아 화면에 표시한다.

**필요 설정**: Vercel 프로젝트의 Settings > Environment Variables 에 `ANTHROPIC_API_KEY` 를
추가해야 이 기능이 동작한다 (키가 없으면 버튼을 눌렀을 때 안내 메시지가 뜬다).

이 분석은 AI가 공개된 정보만으로 생성한 참고 자료이며 법적 자문이 아니다 - 프롬프트에도 이
문구를 마지막 줄에 반드시 포함하도록 지시해 두었다. 입찰 전 매각물건명세서·감정평가서 원본과
등기사항전부증명서를 반드시 직접 확인해야 한다.

## 구조

`index.html`(정적) + 서버리스 함수 3개(`api/docs.js`, `api/analyze.js`, 공통 헬퍼
`api/_lib/court.js`)로 이루어져 있다. 지도·목록·필터는 `data.json`만 읽는 정적 페이지이고,
문서 조회·AI 권리분석 버튼만 서버리스 함수를 탄다.

`package.json`에 `@anthropic-ai/sdk` 의존성이 있으므로, 로컬에서 서버리스 함수를 테스트하려면
`npm install`이 먼저 필요하다. Vercel은 배포 시 자동으로 `npm install`을 실행한다.

## 배포

GitHub에 push 하면 Vercel이 자동으로 배포합니다.
