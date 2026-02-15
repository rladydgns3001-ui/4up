#!/usr/bin/env node
/**
 * 승인된 후기 동기화 + WordPress 배포
 *
 * 사용법: node sync-reviews.js
 *
 * 1. Apps Script에서 승인된 후기를 가져옴
 * 2. reviews-page.html에 하드코딩으로 삽입
 * 3. WordPress에 자동 배포
 */

const fs = require('fs');
const path = require('path');

// 환경변수 로드
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwsa6_rs7JoSijOn9HfV2I31nL6jRBBJNvn2_jGU1JTukNYuL-pPfqvbtIxpemAQeCN/exec';
const HTML_PATH = path.join(__dirname, 'reviews-page.html');
const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

function maskName(name) {
  if (name.length > 2) return name.substring(0, 2) + '**';
  if (name.length > 1) return name.charAt(0) + '*';
  return name;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildReviewHtml(r, num) {
  const masked = maskName(r.name || '익명');
  const isPro = r.plan ? r.plan.indexOf('Pro') >= 0 : false;
  const badgeClass = isPro ? 'rv-badge-pro' : 'rv-badge-paid';
  const badgeText = isPro ? 'Pro' : 'Basic';
  const rating = r.rating || 5;
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const ratingNum = parseFloat(rating).toFixed(1);
  const dateStr = r.date ? r.date.substring(5, 10).replace('-', '.') : '';
  const titleText = (r.content || '').length > 35
    ? escapeHtml((r.content || '').substring(0, 35)) + '...'
    : escapeHtml(r.content || '');

  let tags = '';
  if (r.plan) tags += `<span class="rv-detail-tag">${escapeHtml(r.plan)}</span>`;
  if (r.period) tags += `<span class="rv-detail-tag">${escapeHtml(r.period)}</span>`;

  return `            <div class="rv-board-row" data-cat="paid">
                <div class="rv-col-no">${num}</div>
                <div class="rv-col-title"><span class="rv-badge ${badgeClass}">${badgeText}</span>${titleText}</div>
                <div class="rv-col-author">${escapeHtml(masked)}</div>
                <div class="rv-col-date">${dateStr}</div>
                <div class="rv-col-rating">★ ${ratingNum}</div>
            </div>
            <div class="rv-board-detail">
                <div class="rv-detail-inner">
                    <div class="rv-detail-stars">${stars}</div>
                    <div class="rv-detail-meta">${escapeHtml(masked)} · ${escapeHtml(r.plan || '')} · 사용 ${escapeHtml(r.period || '')}</div>
                    <div class="rv-detail-body">${escapeHtml(r.content || '')}</div>
                    ${tags ? `<div class="rv-detail-tags">${tags}</div>` : ''}
                </div>
            </div>`;
}

async function main() {
  // 1. Apps Script에서 승인된 후기 가져오기
  console.log('📥 승인된 후기 가져오는 중...');
  const res = await fetch(APPS_SCRIPT_URL + '?action=getReviews', { redirect: 'follow' });
  const data = await res.json();
  const reviews = data.reviews || [];

  if (reviews.length === 0) {
    console.log('ℹ️  새로 추가할 후기가 없습니다.');
    return;
  }

  console.log(`📋 승인된 후기 ${reviews.length}개 발견`);

  // 2. HTML 파일 읽기
  let html = fs.readFileSync(HTML_PATH, 'utf-8');

  // 현재 하드코딩된 후기 수 파악
  const countMatch = html.match(/var HARDCODED_REVIEW_COUNT\s*=\s*(\d+)/);
  const currentCount = countMatch ? parseInt(countMatch[1]) : 13;

  // 이미 하드코딩된 동적 후기 이름 목록 (중복 방지)
  const existingNames = [];
  const nameRegex = /rv-detail-meta">([^<]+)/g;
  let m;
  while ((m = nameRegex.exec(html)) !== null) {
    existingNames.push(m[1].split(' · ')[0].trim());
  }

  // 새 후기만 필터링
  const newReviews = reviews.filter(r => {
    const masked = maskName(r.name || '익명');
    return !existingNames.includes(masked);
  });

  if (newReviews.length === 0) {
    console.log('ℹ️  모든 후기가 이미 반영되어 있습니다.');
    return;
  }

  console.log(`✨ 새 후기 ${newReviews.length}개 추가`);

  // 3. 새 후기 HTML 생성 (최신순)
  const newCount = currentCount + newReviews.length;
  let newRowsHtml = '';
  newReviews.reverse().forEach((r, i) => {
    const num = currentCount + newReviews.length - i;
    newRowsHtml += buildReviewHtml(r, num) + '\n';
  });

  // 4. HTML에 삽입 (동적 후기 영역 다음, 기존 정적 후기 앞)
  const insertMarker = '<!-- 정적 후기 -->';
  const altMarker = '<!-- 승인된 후기 -->';
  let marker = html.includes(insertMarker) ? insertMarker : altMarker;

  if (!html.includes(marker)) {
    // 마커가 없으면 첫 번째 rv-board-row 앞에 삽입
    marker = '<div class="rv-board-row"';
    const idx = html.indexOf(marker, html.indexOf('rv-dynamic-rows'));
    if (idx === -1) {
      console.error('❌ 삽입 위치를 찾을 수 없습니다.');
      process.exit(1);
    }
    html = html.substring(0, idx) + `<!-- 승인된 후기 -->\n${newRowsHtml}\n            ` + html.substring(idx);
  } else {
    html = html.replace(marker, `${marker}\n${newRowsHtml}`);
  }

  // 5. 카운트 업데이트
  html = html.replace(/var HARDCODED_REVIEW_COUNT\s*=\s*\d+/, `var HARDCODED_REVIEW_COUNT = ${newCount}`);
  html = html.replace(/(<strong id="rv-total-count">)\d+\+/, `$1${newCount}+`);
  html = html.replace(/(id="rv-tab-all-count">\()\d+\)/, `$1${newCount})`);
  html = html.replace(/(id="rv-tab-paid-count">\()\d+\)/, `$1${newCount})`);

  // 6. 파일 저장
  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  console.log('💾 reviews-page.html 업데이트 완료');

  // 7. WordPress 배포
  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    console.log('⚠️  WordPress 환경변수 없음. 배포 스킵.');
    return;
  }

  console.log('🚀 WordPress 배포 중...');
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
  const wpContent = `<!-- wp:html -->\n${html}\n<!-- /wp:html -->`;

  const wpRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages/209`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: wpContent }),
  });

  if (!wpRes.ok) {
    const err = await wpRes.text();
    console.error('❌ 배포 실패:', err);
    process.exit(1);
  }

  // 8. 메인 페이지(17) + 상품 페이지(431) 후기 수 업데이트
  for (const pageId of [17, 431]) {
    try {
      const pgRes = await fetch(`${WP_URL}/wp-json/wp/v2/pages/${pageId}?context=edit`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const pgData = await pgRes.json();
      const raw = pgData.content.raw;
      if (!raw) { console.log(`⚠️  페이지 ${pageId}: raw 콘텐츠 없음. 스킵.`); continue; }
      let updated = raw.replace(/\d+\+\s*리뷰/g, `${newCount}+ 리뷰`);
      updated = updated.replace(/리뷰\s*\d+\+/g, `리뷰 ${newCount}+`);
      updated = updated.replace(/"reviewCount":\s*"\d+"/g, `"reviewCount": "${newCount}"`);
      if (updated !== raw) {
        await fetch(`${WP_URL}/wp-json/wp/v2/pages/${pageId}`, {
          method: 'PUT',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: updated }),
        });
        console.log(`📄 페이지 ${pageId} 후기 수 업데이트 완료`);
      }
    } catch (e) { /* 무시 */ }
  }

  console.log(`✅ 완료! 후기 ${newCount}개 (${newReviews.length}개 추가)`);
  console.log(`🎉 확인: ${WP_URL}/reviews/`);
}

main().catch(err => {
  console.error('에러:', err.message);
  process.exit(1);
});
