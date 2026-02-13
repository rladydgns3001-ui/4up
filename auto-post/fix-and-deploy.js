/**
 * CSS에 !important 추가 + body 내용만 추출 + wp:html 블록 감싸기 + 배포
 */
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');

const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

function addImportantToCSS(css) {
  const lines = css.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('@') ||
      trimmed === '}' ||
      trimmed.endsWith('{') ||
      trimmed.includes('!important') ||
      !trimmed.includes(';')
    ) {
      result.push(line);
      continue;
    }

    const modified = line.replace(/([^;{}\n]+?)(;)/g, (match, before, semi) => {
      const t = before.trim();
      if (t.includes(':') && !t.startsWith('@') && !t.startsWith('/*')) {
        const colonIdx = t.indexOf(':');
        const prop = t.substring(0, colonIdx).trim();
        if (/^-?-?[a-z][a-z0-9-]*$/i.test(prop)) {
          if (!before.includes('!important')) {
            return before + ' !important' + semi;
          }
        }
      }
      return match;
    });

    result.push(modified);
  }

  return result.join('\n');
}

async function uploadMedia(filePath, filename, contentType) {
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
    console.error(`❌ ${filename}:`, await res.text());
    return null;
  }
  const media = await res.json();
  console.log(`✅ ${filename} → ${media.source_url}`);
  return media.source_url;
}

async function main() {
  console.log('🚀 수정 + 배포 시작\n');

  // 1. 미디어 업로드
  const thumbPath = path.join(__dirname, '..', 'detail-page', 'output', 'product-thumbnail.png');
  let thumbUrl = '';
  if (fs.existsSync(thumbPath)) {
    thumbUrl = await uploadMedia(thumbPath, `product-thumb-${Date.now()}.png`, 'image/png');
  }

  const videoPath = path.join(__dirname, '녹화_2026_02_13_02_19_49_484.mp4');
  let videoUrl = '';
  if (fs.existsSync(videoPath)) {
    videoUrl = await uploadMedia(videoPath, `demo-${Date.now()}.mp4`, 'video/mp4');
  }

  // 2. HTML 읽기
  let html = fs.readFileSync(path.join(__dirname, 'wordpress-homepage.html'), 'utf-8');

  // 3. <body>...</body> 안의 내용만 추출
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    html = bodyMatch[1].trim();
  }

  // 4. CSS에 !important 추가
  html = html.replace(/<style>([\s\S]*?)<\/style>/g, (match, cssContent) => {
    return '<style>' + addImportantToCSS(cssContent) + '</style>';
  });

  // 5. 이미지/영상 URL 교체
  if (thumbUrl) {
    html = html.replace(/src="product-thumbnail\.png"/g, `src="${thumbUrl}"`);
    html = html.replace(/poster="product-thumbnail\.png"/g, `poster="${thumbUrl}"`);
  }
  if (videoUrl) {
    html = html.replace(/src="threads-images\/program-run-1\.mp4"/g, `src="${videoUrl}"`);
  }

  // 6. <!-- wp:html --> 블록으로 감싸기 (wpautop 방지)
  const wpContent = `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;

  // 7. 배포
  console.log('\n📄 WordPress 페이지 업데이트 중...');
  console.log('컨텐츠 길이:', wpContent.length);

  const res = await fetch(`${WP_URL}/wp-json/wp/v2/pages/17`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: wpContent }),
  });

  if (!res.ok) {
    console.error('❌ 실패:', await res.text());
    process.exit(1);
  }

  console.log('✅ 배포 완료! → ' + WP_URL);
}

main().catch(console.error);
