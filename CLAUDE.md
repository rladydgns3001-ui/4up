# AutoPost SEO Writer 프로젝트

## 프로젝트 개요
AI 블로그 자동 포스팅 프로그램(AutoPost SEO Writer) 판매 사이트

## WordPress 사이트
- URL: https://wpauto.kr
- 메인 페이지 ID: 17
- 상품 페이지 ID: 431 (slug: product)
- 후기 페이지 ID: 209 (slug: reviews)
- 이용약관 페이지 ID: 563 (slug: terms)
- 환불규정 페이지 ID: 565 (slug: refund-policy)
- 개인정보처리방침 페이지 ID: 3 (slug: privacy-policy)
- 테마: GeneratePress

## 핵심 파일
### 페이지 HTML
- `auto-post/wordpress-homepage-new.html` — 메인 페이지 HTML
- `auto-post/wordpress-product-page.html` — 상품 상세 페이지 HTML
- `auto-post/reviews-page.html` — 후기 페이지 HTML
- `auto-post/terms.html` — 이용약관 페이지 HTML
- `auto-post/refund-policy.html` — 환불규정 페이지 HTML
- `auto-post/privacy-policy.html` — 개인정보처리방침 페이지 HTML

### 배포 스크립트
- `auto-post/deploy-homepage.js` — 메인+상품+법적페이지 배포 (node deploy-homepage.js)
- `auto-post/deploy-reviews.js` — 후기 페이지 배포
- `auto-post/sync-reviews.js` — 후기 동기화

### 웹훅 & 이메일
- `auto-post/webhook-server.js` — Polar 웹훅 서버 (order.paid → Resend 이메일 발송)
- `auto-post/email-templates.js` — 구매 확인 이메일 HTML 템플릿
- `auto-post/send-receipt.js` — 수동 이메일 발송 (테스트/재발송용)

### 환경변수
- `auto-post/.env` — WP_URL, WP_USER, WP_APP_PASSWORD, POLAR_ACCESS_TOKEN, RESEND_API_KEY 등

## Polar 결제 연동
- 대시보드: https://polar.sh/dashboard/autopost123
- Organization ID: `3339f5f7-799c-4f5c-8290-7bd8bad5c053`
- API Token: `.env` 파일 `POLAR_ACCESS_TOKEN` 참조
- Polar는 Merchant of Record(MoR) — 결제, 세금, 영수증 처리

### 상품 정보
| 상품 | Product ID | 가격 | Checkout Link |
|------|-----------|------|---------------|
| AutoPost Basic | `052ab04d-804d-44bd-89b1-d8b1f638e745` | $199 | `https://buy.polar.sh/polar_cl_fe87hwMA3m0dVJV1WsgZYXdQsBaN7SPT7MBnt3OxN2F` |
| AutoPost V2 Pro | `93bce0cc-8514-4e54-afde-5dc1b3c5cf70` | $269 | `https://buy.polar.sh/polar_cl_nNbRQOzhTaLykgm7Dvs40gSiIYsZLHMeRxrYS3as8zS` |

### Checkout 연동 방식
- Polar Checkout Embed 스크립트 사용 (`data-polar-checkout` 속성)
- 상품 페이지 JS: `planData` 객체로 Basic/Pro URL 관리, `sidebarPlanChange()`/`floatingPlanChange()`로 드롭다운 변경 시 CTA href 자동 전환

### CTA 버튼 구분
- **구매 버튼** (Polar checkout): 블루 `#2563EB` bg / `#fff` text
- **상담 버튼** (카카오톡): 노란 `#FEE500` bg / `#191919` text
- 카카오톡 오픈채팅: https://open.kakao.com/o/sjcFzkei

## 상품 페이지 레이아웃 (PC)
- `.ap-product-top` max-width: 1100px (이미지 + 가격란 컨테이너)
- `.ap-product-thumb` flex:1 (썸네일 이미지, 넓게)
- `.ap-top-sidebar` flex:0 0 300px, padding:24px (가격란 사이드바)
- `.ap-sidebar` flex:0 0 300px (스크롤 따라다니는 사이드바, 768px 이하에서 숨김)

## 상품 페이지 레이아웃 (모바일 768px 이하)
- `.ap-product-top` 세로 배치 (flex-direction: column)
- `.ap-product-thumb` max-width: 260px 중앙 정렬
- `.ap-top-sidebar` 전체 너비, 사이드바→가로 배치
- `.ap-floating-bar` 하단 고정 CTA 노출

## CSS 클래스 접두사
- 모든 클래스: `ap-` 접두사 사용 (WordPress 충돌 방지)
- 페이지 스코프: `.page-id-431` (상품 페이지 전용 오버라이드)

## 후기 시스템
- Telegram 봇으로 후기 승인/거절
- 승인된 후기 → WordPress 자동 배포
- Apps Script 연동: `auto-post/apps-script-review.js`

## 컬러 스킴
- 전체 테마: 모던 블루 계열 (Google/Meta 스타일)
  - 메인 액센트: `#2563EB` (blue-600)
  - 서브 액센트: `#3B82F6` (blue-500)
  - 라이트 액센트: `#60A5FA` (blue-400)
  - 다크 액센트: `#1e40af` (blue-800)
  - 배경 틴트: `#EFF6FF`, `#DBEAFE` (연한 블루)
  - 태그/뱃지 배경: `#DBEAFE`
  - 진한 틴트: `#BFDBFE`
  - 푸터 링크: `#93C5FD`
  - 그림자: `rgba(37,99,235,...)`, `rgba(59,130,246,...)`
- 기타 고정 색상: 별점 `#ffbc00`, BEST 뱃지 `#ef4444`, 푸터 `#0a1929`

## Polar MoR 규정 준수 (2026-02-15 적용)
- 수입 금액 주장 제거 (5억, 10만달러, 4500만원, 200~300달러 등)
- "수익형 블로그" → "블로그" / "AI 블로그"로 완화
- "수익 극대화" → "콘텐츠 품질에 집중" 등으로 변경
- "시간 투자 없이 수익화" → "블로그 운영 시간 대폭 절약"
- 가짜 희소성 제거 (1차 마감/2차 마감/3차 진행 중)
- 취소선 가격 제거 ($539→$269, $399→$199의 원래가격 삭제)
- "10~30개/day" 대량 발행 수치 제거/완화
- 법적 페이지 3개 생성 (이용약관, 환불규정, 개인정보처리방침)

## 웹훅 서버 (Polar → Resend 이메일 자동 발송)
- 호스팅: Render (Free tier) — https://fourup.onrender.com
- 서버: `auto-post/webhook-server.js` (포트 3000)
- 엔드포인트:
  - `POST /webhooks/polar` — order.paid 수신 → Resend 이메일 발송 (실패 시 자동 환불)
  - `GET /health` — 헬스체크
- 이메일: Resend API (발신: `noreply@wpauto.kr`, 도메인 인증 완료)
- 서명 검증: `standardwebhooks` 라이브러리 (POLAR_WEBHOOK_SECRET)
- 자동 환불: 이메일 발송 실패 시 Polar Refund API로 전액 환불
- 수동 발송: `node auto-post/send-receipt.js --email <email> --plan <basic|pro>`

### 상품 전달 방식
- Google Drive 공유 링크 + 비밀번호 보호 zip 파일
- Basic/Pro 플랜별 별도 다운로드 URL 및 비밀번호
- .env 환경변수: `DOWNLOAD_URL_BASIC/PRO`, `DOWNLOAD_PASSWORD_BASIC/PRO`
- 이메일에 다운로드 버튼 + 압축 해제 비밀번호 포함

### Polar 웹훅
- 웹훅 ID: `72d46607-45a6-4eea-ac24-a62dc6aee9be`
- URL: `https://fourup.onrender.com/webhooks/polar`
- 이벤트: `order.paid`
- Secret: `.env` 파일 `POLAR_WEBHOOK_SECRET` 참조

### Render 배포
- 서비스: 4up (Web Service, Free tier)
- GitHub: `rladydgns3001-ui/4up` → `main` 브랜치 자동 배포
- Root Directory: `auto-post`
- Build Command: `npm install`
- Start Command: `node webhook-server.js`
- 환경변수: Render Environment에 설정 (RESEND_API_KEY, POLAR_ACCESS_TOKEN 등)
- 주의: Free tier는 비활성 시 스핀다운 (첫 요청 ~50초 지연)

### Resend 이메일
- 도메인: wpauto.kr (Verified, Tokyo ap-northeast-1)
- DNS: 가비아에서 DKIM, SPF (MX+TXT), DMARC 레코드 추가 완료
- 무료 플랜: 월 3,000건 / 일 100건

## 주의사항
- 배포 시 미디어(썸네일, 영상)도 함께 업로드됨
- CSS는 minified 한 줄로 관리 (line 6에 전체 스타일)
- 모바일/PC 반응형 구분 필수 확인
- Polar MoR 규정 위반 금지: 소득 보장, 가짜 희소성, 가짜 할인가 사용 불가
