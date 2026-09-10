# 전국 공매물건 지도 (온비드) 🔨

전국 지도 위에 캠코(한국자산관리공사) 온비드 공매물건을 표시하는 웹 앱입니다.

- **지도**: 카카오맵 (소재지 → 좌표 자동 변환)
- **데이터**: 캠코 온비드 공매물건 API (공공데이터포털, 무료)
  - 엔드포인트: `ThingInfoInquireSvc/getUnifyUsageCltr` (통합 용도별 물건목록)
- **기능**: 용도별 필터, 물건 마커(최저입찰가), 목록, 상세정보(감정가·최저입찰가·입찰기간 등)

## 구조

```
브라우저(index.html) → Vercel 서버함수(/api/deals.js) → 온비드 API
```

서버함수가 인증키를 숨기고, XML을 JSON으로 변환해 전달합니다.

## 설정 (중요)

1. 공공데이터포털(data.go.kr)에서 **"한국자산관리공사_온비드 물건정보 조회서비스"** 활용신청 → 인증키(Decoding) 발급
2. Vercel 프로젝트 설정 → Environment Variables 에 `DATA_GO_KR_KEY` = 인증키 등록
3. 재배포(Redeploy)

## 배포

GitHub에 push 하면 Vercel이 자동으로 배포합니다.
