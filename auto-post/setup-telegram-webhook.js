#!/usr/bin/env node
/**
 * Telegram Webhook 등록 스크립트 (1회 실행)
 *
 * 사용법:
 *   node setup-telegram-webhook.js <APPS_SCRIPT_WEB_APP_URL>
 *
 * 예시:
 *   node setup-telegram-webhook.js https://script.google.com/macros/s/AKfycb.../exec
 *
 * .env.threads 파일에서 TELEGRAM_BOT_TOKEN을 읽습니다.
 */

const fs = require('fs');
const path = require('path');

// .env.threads에서 환경변수 로드
const envPath = path.join(__dirname, '.env.threads');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.argv[2];

if (!BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
  console.error('.env.threads 파일에 TELEGRAM_BOT_TOKEN을 추가하세요.');
  process.exit(1);
}

if (!webhookUrl) {
  console.error('사용법: node setup-telegram-webhook.js <APPS_SCRIPT_URL>');
  console.error('예시:   node setup-telegram-webhook.js https://script.google.com/macros/s/AKfycb.../exec');
  process.exit(1);
}

async function main() {
  const apiBase = `https://api.telegram.org/bot${BOT_TOKEN}`;

  // 1. 기존 webhook 삭제
  console.log('기존 webhook 삭제 중...');
  let res = await fetch(`${apiBase}/deleteWebhook`);
  let data = await res.json();
  console.log('deleteWebhook:', data.ok ? '성공' : data.description);

  // 2. 새 webhook 등록
  console.log(`\nWebhook 등록 중: ${webhookUrl}`);
  res = await fetch(`${apiBase}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['callback_query']
    })
  });
  data = await res.json();

  if (data.ok) {
    console.log('Webhook 등록 성공!');
  } else {
    console.error('Webhook 등록 실패:', data.description);
    process.exit(1);
  }

  // 3. webhook 상태 확인
  console.log('\nWebhook 정보 확인...');
  res = await fetch(`${apiBase}/getWebhookInfo`);
  data = await res.json();
  console.log('URL:', data.result.url);
  console.log('허용 업데이트:', data.result.allowed_updates || '(전체)');
  console.log('대기 업데이트:', data.result.pending_update_count);
  if (data.result.last_error_message) {
    console.log('마지막 에러:', data.result.last_error_message);
  }

  console.log('\n설정 완료! Apps Script가 Telegram 콜백을 수신합니다.');
}

main().catch(err => {
  console.error('에러:', err.message);
  process.exit(1);
});
