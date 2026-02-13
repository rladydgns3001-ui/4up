require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');

const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

async function uploadMedia(filePath, filename) {
  const buffer = fs.readFileSync(filePath);
  const res = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
    body: buffer,
  });
  if (!res.ok) {
    console.error(`❌ ${filename} 실패:`, await res.text());
    return null;
  }
  const media = await res.json();
  return media.source_url;
}

async function main() {
  const outputDir = path.join(__dirname, '..', 'detail-page', 'output');
  const urls = {};

  for (let i = 1; i <= 12; i++) {
    const num = String(i).padStart(2, '0');
    const filename = `detail-${num}.png`;
    const filePath = path.join(outputDir, filename);

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️ ${filename} 없음, 스킵`);
      continue;
    }

    console.log(`📤 [${i}/12] ${filename} 업로드 중...`);
    const url = await uploadMedia(filePath, `detail-${num}-${Date.now()}.png`);
    if (url) {
      urls[num] = url;
      console.log(`✅ ${url}`);
    }
  }

  // JSON으로 URL 목록 저장
  const outPath = path.join(__dirname, 'detail-image-urls.json');
  fs.writeFileSync(outPath, JSON.stringify(urls, null, 2));
  console.log(`\n📋 URL 목록 저장: ${outPath}`);
}

main().catch(console.error);
