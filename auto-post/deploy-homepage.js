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

function replaceMediaUrls(html, thumbUrl, videoUrl) {
  if (thumbUrl) {
    html = html.replace(/src="product-thumbnail\.png"/g, `src="${thumbUrl}"`);
    html = html.replace(/poster="product-thumbnail\.png"/g, `poster="${thumbUrl}"`);
  }
  if (videoUrl) {
    html = html.replace(/<source src="(threads-images\/program-run-1\.mp4|0211\(3\)\.mp4)" type="video\/mp4">/g, `<source src="${videoUrl}" type="video/mp4">`);
  }
  return html;
}

async function findOrCreateProductPage() {
  // slug "product" 페이지 검색
  console.log('\n🔍 상품 페이지 (slug: product) 검색 중...');
  const searchRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages?slug=product&status=publish,draft`, {
    headers: { Authorization: `Basic ${AUTH}` },
  });

  if (!searchRes.ok) {
    const err = await searchRes.text();
    console.error('❌ 페이지 검색 실패:', err);
    return null;
  }

  const pages = await searchRes.json();

  if (pages.length > 0) {
    console.log(`✅ 기존 상품 페이지 발견 (ID: ${pages[0].id})`);
    return pages[0].id;
  }

  // 없으면 새 페이지 생성
  console.log('📝 상품 페이지 생성 중...');
  const createRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'AutoPost SEO Writer 상품 상세',
      slug: 'product',
      status: 'publish',
      content: '',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error('❌ 페이지 생성 실패:', err);
    return null;
  }

  const newPage = await createRes.json();
  console.log(`✅ 상품 페이지 생성 완료 (ID: ${newPage.id})`);
  return newPage.id;
}

async function main() {
  console.log('🚀 홈페이지 + 상품 페이지 배포 시작...\n');

  // 1. 미디어 업로드
  const thumbPath = path.join(__dirname, '..', 'detail-page', 'output', 'product-thumbnail.png');
  let thumbUrl = '';
  if (fs.existsSync(thumbPath)) {
    thumbUrl = await uploadMedia(thumbPath, `product-thumbnail-${Date.now()}.png`, 'image/png');
  } else {
    console.log('⚠️ product-thumbnail.png 없음, 스킵');
  }

  const videoPath = path.join(__dirname, '0211(3).mp4');
  let videoUrl = '';
  if (fs.existsSync(videoPath)) {
    videoUrl = await uploadMedia(videoPath, `autopost-demo-${Date.now()}.mp4`, 'video/mp4');
  } else {
    console.log('⚠️ 시현 영상 없음, 스킵');
  }

  // 2. 새 메인 페이지 HTML 읽기 & 미디어 URL 교체
  let homepageHtml = fs.readFileSync(path.join(__dirname, 'wordpress-homepage-new.html'), 'utf-8');
  homepageHtml = replaceMediaUrls(homepageHtml, thumbUrl, videoUrl);

  // 3. 메인 페이지 업데이트 (Page ID: 17)
  console.log('\n📄 메인 페이지 (ID: 17) 업데이트 중...');
  const homeRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages/17`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: `<!-- wp:html -->\n${homepageHtml}\n<!-- /wp:html -->` }),
  });

  if (!homeRes.ok) {
    const err = await homeRes.text();
    console.error('❌ 메인 페이지 업데이트 실패:', err);
    process.exit(1);
  }

  const homePage = await homeRes.json();
  console.log('✅ 메인 페이지 업데이트 완료!');
  console.log(`🎉 확인: ${homePage.link || WP_URL}`);

  // 4. 상품 페이지 (slug: product) 찾기 또는 생성
  const productPageId = await findOrCreateProductPage();
  if (!productPageId) {
    console.error('❌ 상품 페이지 처리 실패');
    process.exit(1);
  }

  // 5. 상품 페이지 HTML 읽기 & 미디어 URL 교체
  let productHtml = fs.readFileSync(path.join(__dirname, 'wordpress-product-page.html'), 'utf-8');
  productHtml = replaceMediaUrls(productHtml, thumbUrl, videoUrl);

  // 6. 상품 페이지 업데이트
  console.log(`\n📄 상품 페이지 (ID: ${productPageId}) 업데이트 중...`);
  const productRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages/${productPageId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: `<!-- wp:html -->\n${productHtml}\n<!-- /wp:html -->`,
      slug: 'product',
      status: 'publish',
    }),
  });

  if (!productRes.ok) {
    const err = await productRes.text();
    console.error('❌ 상품 페이지 업데이트 실패:', err);
    process.exit(1);
  }

  const productPage = await productRes.json();
  console.log('✅ 상품 페이지 업데이트 완료!');
  console.log(`🎉 확인: ${productPage.link || WP_URL + '/product/'}`);

  console.log('\n🎊 모든 배포 완료!');
  console.log('📌 메인 페이지: ' + (homePage.link || WP_URL));
  console.log('📌 상품 페이지: ' + (productPage.link || WP_URL + '/product/'));
}

main().catch(console.error);
