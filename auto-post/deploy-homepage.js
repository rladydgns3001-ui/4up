require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');

const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

async function uploadMedia(filePath, filename, contentType) {
  console.log(`📤 업로드 중: ${filename}`);
  const buffer = fs.readFileSync(filePath);

  const res = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
    body: buffer,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ 업로드 실패 (${filename}):`, err);
    return null;
  }

  const media = await res.json();
  console.log(`✅ 업로드 완료: ${media.source_url}`);
  return media.source_url;
}

async function main() {
  console.log('🚀 홈페이지 배포 시작...\n');

  // 1. 제품 썸네일 업로드
  const thumbPath = path.join(__dirname, '..', 'detail-page', 'output', 'product-thumbnail.png');
  let thumbUrl = '';
  if (fs.existsSync(thumbPath)) {
    thumbUrl = await uploadMedia(thumbPath, `product-thumbnail-${Date.now()}.png`, 'image/png');
  } else {
    console.log('⚠️ product-thumbnail.png 없음, 스킵');
  }

  // 2. 시현 영상 업로드
  const videoPath = path.join(__dirname, '녹화_2026_02_13_02_19_49_484.mp4');
  let videoUrl = '';
  if (fs.existsSync(videoPath)) {
    videoUrl = await uploadMedia(videoPath, `autopost-demo-${Date.now()}.mp4`, 'video/mp4');
  } else {
    console.log('⚠️ 시현 영상 없음, 스킵');
  }

  // 3. HTML 읽기
  let html = fs.readFileSync(path.join(__dirname, 'wordpress-homepage.html'), 'utf-8');

  // 4. 로컬 경로를 워드프레스 URL로 교체
  if (thumbUrl) {
    html = html.replace(/src="product-thumbnail\.png"/g, `src="${thumbUrl}"`);
    html = html.replace(/poster="product-thumbnail\.png"/g, `poster="${thumbUrl}"`);
  }
  if (videoUrl) {
    html = html.replace(/<source src="threads-images\/program-run-1\.mp4" type="video\/mp4">/, `<source src="${videoUrl}" type="video/mp4">`);
  }

  // 5. 워드프레스 페이지 업데이트 (ID: 17)
  console.log('\n📄 워드프레스 페이지 업데이트 중...');

  const pageRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages/17`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: html }),
  });

  if (!pageRes.ok) {
    const err = await pageRes.text();
    console.error('❌ 페이지 업데이트 실패:', err);
    process.exit(1);
  }

  const page = await pageRes.json();
  console.log('✅ 홈페이지 업데이트 완료!');
  console.log(`🎉 확인: ${page.link || WP_URL}`);
}

main().catch(console.error);
