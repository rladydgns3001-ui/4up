# 배포 가이드

## 페이지별 배포 스크립트

| 페이지 | HTML 파일 | 배포 스크립트 | WP 페이지 ID | 워크플로우 |
|--------|-----------|-------------|-------------|-----------|
| 홈페이지 | `wordpress-homepage.html` | `deploy-homepage.js` | 17 | `deploy-homepage.yml` |
| 후기 페이지 | `reviews-page.html` | `deploy-reviews.js` | 209 | `deploy-reviews.yml` |

## 로컬 배포 (환경변수 필요)

```bash
# 홈페이지 (썸네일 + 시현영상 업로드 포함)
WP_URL=https://wpauto.kr WP_USER=아이디 WP_APP_PASSWORD=비밀번호 node auto-post/deploy-homepage.js

# 후기 페이지
WP_URL=https://wpauto.kr WP_USER=아이디 WP_APP_PASSWORD=비밀번호 node auto-post/deploy-reviews.js
```

## GitHub Actions 배포 (시크릿 사용)

```bash
# 푸시 후 GitHub에서 수동 실행
# Actions → Deploy Homepage → Run workflow
# Actions → Deploy Reviews Page → Run workflow
```

## 필수 시크릿 (GitHub Settings → Secrets)

- `WP_URL` — WordPress 사이트 URL (예: https://wpauto.kr)
- `WP_USER` — WordPress 사용자명
- `WP_APP_PASSWORD` — WordPress 앱 비밀번호

## 미디어 파일

- 제품 썸네일: `detail-page/output/product-thumbnail.png`
  - 생성: `node auto-post/gen-thumbnail.js`
  - 소스: `auto-post/product-thumbnail.html`
- 시현 영상: `auto-post/0211(3).mp4`

## 새 페이지 추가 시 템플릿

1. `auto-post/새페이지.html` 작성
2. `auto-post/deploy-새페이지.js` 생성 (deploy-reviews.js 복사 후 페이지 ID 변경)
3. `.github/workflows/deploy-새페이지.yml` 생성
