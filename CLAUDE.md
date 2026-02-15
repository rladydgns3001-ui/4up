# AutoPost SEO Writer 프로젝트

## 프로젝트 개요
AI 수익형 블로그 자동 포스팅 프로그램(AutoPost SEO Writer) 판매 사이트

## WordPress 사이트
- URL: https://wpauto.kr
- 메인 페이지 ID: 17
- 상품 페이지 ID: 431 (slug: product)
- 테마: GeneratePress

## 핵심 파일
### 페이지 HTML
- `auto-post/wordpress-homepage-new.html` — 메인 페이지 HTML
- `auto-post/wordpress-product-page.html` — 상품 상세 페이지 HTML
- `auto-post/reviews-page.html` — 후기 페이지 HTML

### 배포 스크립트
- `auto-post/deploy-homepage.js` — 메인+상품 페이지 배포 (node deploy-homepage.js)
- `auto-post/deploy-reviews.js` — 후기 페이지 배포
- `auto-post/sync-reviews.js` — 후기 동기화

### 환경변수
- `auto-post/.env` — WP_URL, WP_USER, WP_APP_PASSWORD 등

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
- 구매 CTA 버튼: 블루 계열
  - 배경: `#2563EB` / 텍스트: `#fff`
  - 적용 클래스: `.hp-price-cta`, `.hp-btn-primary[data-polar-checkout]` (홈), `.ap-sidebar-cta`, `.ap-planc .pcta`, `.ap-floating-btn` (상품)
  - 파란 배경 위: `#fff` bg / `#2563EB` text (`.hp-cta-section .hp-btn-primary[data-polar-checkout]`, `.ap-final-cta-btn`)
- 카카오톡 상담 버튼: 노란색 계열
  - 배경: `#FEE500` (카카오 공식 노란색)
  - 텍스트: `#191919` (다크)
  - 적용 클래스: `.hp-nav-cta`, `.hp-btn-primary` (기본, 상담용) (홈), `.ap-top-nav-cta` (상품)
- 기타 고정 색상: 별점 `#ffbc00`, BEST 뱃지 `#ef4444`, 푸터 `#0a1929`

## 주의사항
- 배포 시 미디어(썸네일, 영상)도 함께 업로드됨
- CSS는 minified 한 줄로 관리 (line 5에 전체 스타일)
- 모바일/PC 반응형 구분 필수 확인
