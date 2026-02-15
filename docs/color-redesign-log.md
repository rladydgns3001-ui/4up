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
- `planData` 에 `url` 속성 추가 (Basic/Pro 각각)
- `sidebarPlanChange()` → 드롭다운 변경 시 사이드바/플로팅바 CTA href 자동 전환
- Sandbox URL 잔존: 0건

### 기존 sandbox 상품 (정리 필요)
- `3cb7d3a7-f6e9-47ea-aad1-2c5fc0ff0dc4` — 이미지 없는 AutoPost Basic (삭제 가능)
