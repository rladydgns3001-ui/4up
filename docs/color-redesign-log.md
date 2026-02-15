# 사이트 리디자인 + Polar 프로덕션 전환 (2026-02-15)

## 1. 색상 리디자인: 보라색 → 모던 블루

### 개요
사이트 전체 보라색 테마를 Google/Meta 스타일의 모던 블루로 전면 교체.
구매 CTA 버튼도 카카오 노란색 → 블루로 변경. 상담(카카오톡) 버튼만 노란색 유지.

### 수정 파일
1. `auto-post/wordpress-homepage-new.html` — 메인 페이지 CSS
2. `auto-post/wordpress-product-page.html` — 상품 페이지 CSS + inline styles + JS
3. `CLAUDE.md` — 컬러 스킴 문서 업데이트

### 컬러 매핑

| 기존 (보라) | 변경 (블루) | 용도 |
|------------|-----------|------|
| `#7C3AED` | `#2563EB` | 메인 액센트 |
| `#A855F7` | `#3B82F6` | 서브 액센트 |
| `#C084FC` | `#60A5FA` | 라이트 액센트 |
| `#C4B5FD` | `#93C5FD` | 푸터 링크 |
| `#4338ca` | `#1e40af` | 다크 액센트 |
| `#f3e8ff` | `#EFF6FF` | 연한 배경 |
| `#e9d5ff` | `#DBEAFE` | 히어로 그라데이션 |
| `#f5f0ff` | `#EFF6FF` | 대체 연한 배경 |
| `#ede9fe` | `#DBEAFE` | 태그/뱃지 배경 |
| `#ddd6fe` | `#BFDBFE` | 진한 틴트 |
| `#f0f4ff` | `#EFF6FF` | 테이블 헤더 |
| `rgba(168,85,247,...)` | `rgba(59,130,246,...)` | 그림자 (서브) |
| `rgba(124,58,237,...)` | `rgba(37,99,235,...)` | 그림자 (메인) |

### CTA 버튼 색상

| 버튼 | 용도 | 색상 |
|------|------|------|
| `.ap-sidebar-cta`, `.pcta`, `.ap-floating-btn` | 구매 (Polar) | `#2563EB` bg / `#fff` text |
| `.ap-final-cta-btn` | 구매 (파란 배경 위) | `#fff` bg / `#2563EB` text |
| `.ap-top-nav-cta` | 상담 (카카오톡) | `#FEE500` 유지 |
| `.hp-price-cta` | 구매 (Polar) | `#2563EB` bg / `#fff` text |
| `.hp-btn-primary[data-polar-checkout]` | 구매 (Polar) | `#2563EB` bg / `#fff` text |
| `.hp-cta-section .hp-btn-primary[data-polar-checkout]` | 구매 (파란 배경 위) | `#fff` bg / `#2563EB` text |
| `.hp-btn-primary` (기본) | 상담 (카카오톡) | `#FEE500` 유지 |
| `.hp-nav-cta` | 상담 (카카오톡) | `#FEE500` 유지 |

### 검증 결과
- 보라색 hex/rgba: 양쪽 파일 모두 0건
- `#FEE500`: 상담 버튼에만 잔존 확인

---

## 2. Polar 프로덕션 전환

### Polar 계정
- 대시보드: https://polar.sh/dashboard/autopost123
- Organization ID: `3339f5f7-799c-4f5c-8290-7bd8bad5c053`
- API Token: `.env` 파일 `POLAR_ACCESS_TOKEN` 참조

### 상품 정보

| 상품 | Product ID | 가격 | Checkout Link |
|------|-----------|------|---------------|
| AutoPost Basic | `052ab04d-804d-44bd-89b1-d8b1f638e745` | $199 | `https://buy.polar.sh/polar_cl_fe87hwMA3m0dVJV1WsgZYXdQsBaN7SPT7MBnt3OxN2F` |
| AutoPost V2 Pro | `93bce0cc-8514-4e54-afde-5dc1b3c5cf70` | $269 | `https://buy.polar.sh/polar_cl_nNbRQOzhTaLykgm7Dvs40gSiIYsZLHMeRxrYS3as8zS` |

### URL 매핑 (Checkout Link 배치)

**홈페이지 (`wordpress-homepage-new.html`)**
| 위치 | 상품 |
|------|------|
| Basic 가격 카드 `.hp-price-cta` | Basic |
| Pro 가격 카드 `.hp-price-cta` | Pro |
| Final CTA `.hp-btn-primary` | Pro (기본) |

**상품 페이지 (`wordpress-product-page.html`)**
| 위치 | 상품 | 비고 |
|------|------|------|
| 상단 사이드바 `#top-sidebar-cta` | Pro (기본) | 드롭다운으로 전환 |
| Basic 플랜 카드 `.pcta` | Basic | 고정 |
| Pro 플랜 카드 `.pcta` | Pro | 고정 |
| 스티키 사이드바 `#sticky-sidebar-cta` | Pro (기본) | 드롭다운으로 전환 |
| Final CTA `.ap-final-cta-btn` | Pro | 고정 |
| 플로팅바 `#floating-cta` | Pro (기본) | 드롭다운으로 전환 |

### JS 동작
- `planData` 에 `url` 속성 (Basic/Pro 각각)
- `sidebarPlanChange()` → 드롭다운 변경 시 사이드바/플로팅바 CTA href 자동 전환
- Sandbox URL 잔존: 0건

---

## 3. Polar MoR 규정 준수 (2026-02-15)

### 홈페이지 수정 사항
- "수익형 블로그를 자동화하세요" → "블로그 운영을 자동화하세요"
- "10,000+ 자동 발행 글" → "1,000+"
- "시간 투자 없이 수익화" → "블로그 운영 시간 대폭 절약"
- 리뷰 "누적 수익 5억" → "블로그 운영이 훨씬 편해졌습니다"
- 리뷰 "하루 수익 200~300달러" → "블로그 운영 효율이 확실히 올라갔어요"
- "수익은 극대화하세요" → "콘텐츠 품질에 집중하세요"
- "하루 10~30개" 수치 제거/완화
- "수익 0원" → "방치 중"
- FAQ "10~30개로 크게 늘어납니다" → "발행 효율이 크게 향상됩니다"
- JSON-LD "AI 수익형" → "AI"

### 상품 페이지 수정 사항
- **가짜 희소성 제거**: "1차 마감/2차 마감/3차 진행 중" → "구매 즉시 다운로드 · 1:1 설치 지원" (2곳)
- **취소선 가격 제거**: $539, $399 원래가격 라인 삭제 + JS `planData.original` 제거
- **Hero**: "수익형 블로그" → "블로그", "수익을 극대화하세요!" → "블로그 성장에 집중하세요!"
- **5개 리뷰 전체 수정**: 모든 수입 금액 (5억, 200~300달러, 10만 달러, 4500만원) 제거
- "즉시 수익화 가능" → "즉시 광고 노출 가능"
- "블로그 수익화를 꿈꾸는 분" → "블로그 성장을 목표로 하는 분"
- "수익은 극대화하세요" → "콘텐츠 품질에 집중하세요"
- "10~30개" 수치 제거/완화 (3곳)
- "AI 수익형" → "AI" (4곳)
- "수익이 안 나" → "방치 중"

---

## 4. 법적 페이지 생성 (2026-02-15)

### 생성된 페이지
| 페이지 | URL | WP Page ID | 파일 |
|--------|-----|-----------|------|
| 서비스 이용약관 | /terms/ | 563 | `auto-post/terms.html` |
| 환불 규정 | /refund-policy/ | 565 | `auto-post/refund-policy.html` |
| 개인정보 처리방침 | /privacy-policy/ | 3 | `auto-post/privacy-policy.html` |

### 주요 내용
- Polar MoR 역할 명시 (결제, 세금, 영수증 처리)
- 디지털 상품 환불 정책 (다운로드 전 7일 이내 환불 가능)
- 한국 법령 준거 (전자상거래법, 개인정보보호법, 콘텐츠산업진흥법)
- 모든 페이지 푸터에 법적 페이지 링크 추가

### 배포
- `deploy-homepage.js`에 `deployPage()` 함수 추가 → 법적 페이지 자동 생성/업데이트
