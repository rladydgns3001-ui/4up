#!/usr/bin/env node
/**
 * 수동 구매 확인 이메일 발송 (Google Drive 다운로드 링크 + zip 비밀번호)
 *
 * Usage:
 *   node send-receipt.js --email buyer@example.com --plan pro
 *   node send-receipt.js --email buyer@example.com --plan basic --name "홍길동"
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const https = require('https');
const { purchaseConfirmationHtml } = require('./email-templates');

const PLANS = {
  basic: {
    productName: 'AutoPost Basic',
    planLabel: 'AutoPost Basic',
    amount: '$199',
    downloadUrl: process.env.DOWNLOAD_URL_BASIC || '',
    downloadPassword: process.env.DOWNLOAD_PASSWORD_BASIC || '',
  },
  pro: {
    productName: 'AutoPost V2 Pro',
    planLabel: 'AutoPost V2 Pro',
    amount: '$269',
    downloadUrl: process.env.DOWNLOAD_URL_PRO || '',
    downloadPassword: process.env.DOWNLOAD_PASSWORD_PRO || '',
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) result.email = args[++i];
    else if (args[i] === '--plan' && args[i + 1]) result.plan = args[++i].toLowerCase();
    else if (args[i] === '--name' && args[i + 1]) result.name = args[++i];
  }
  return result;
}

function sendEmail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [to],
      subject,
      html,
    });

    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`Resend API ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const { email, plan, name } = parseArgs();

  if (!email || !plan) {
    console.error('Usage: node send-receipt.js --email <email> --plan <basic|pro> [--name <name>]');
    process.exit(1);
  }

  if (!PLANS[plan]) {
    console.error(`Unknown plan: "${plan}". Use "basic" or "pro".`);
    process.exit(1);
  }

  // 환경변수 검증
  const envErrors = [];
  if (!process.env.RESEND_API_KEY) {
    envErrors.push('RESEND_API_KEY — Resend API 키 누락');
  } else if (!process.env.RESEND_API_KEY.startsWith('re_')) {
    envErrors.push('RESEND_API_KEY — 유효하지 않은 형식 (re_ 로 시작해야 함)');
  }
  if (!process.env.RESEND_FROM) {
    envErrors.push('RESEND_FROM — 발신자 이메일 누락');
  }
  if (envErrors.length > 0) {
    console.error('❌ .env 환경변수 오류:');
    envErrors.forEach(e => console.error(`   ${e}`));
    process.exit(1);
  }

  const planInfo = PLANS[plan];

  if (!planInfo.downloadUrl) {
    console.warn(`⚠️  DOWNLOAD_URL_${plan.toUpperCase()} 미설정 — 다운로드 링크 없이 발송됩니다.`);
  }
  if (!planInfo.downloadPassword) {
    console.warn(`⚠️  DOWNLOAD_PASSWORD_${plan.toUpperCase()} 미설정 — 비밀번호 없이 발송됩니다.`);
  }

  const data = {
    customerName: name || email.split('@')[0],
    customerEmail: email,
    productName: planInfo.productName,
    planLabel: planInfo.planLabel,
    amount: planInfo.amount,
    orderId: `manual-${Date.now()}`,
    purchaseDate: new Date().toISOString().split('T')[0],
    downloadUrl: planInfo.downloadUrl,
    downloadPassword: planInfo.downloadPassword,
  };

  const html = purchaseConfirmationHtml(data);

  console.log(`Sending purchase confirmation to ${email} (${planInfo.planLabel})...`);

  try {
    const result = await sendEmail({
      to: email,
      subject: `[AutoPost] 구매 확인 — ${planInfo.planLabel}`,
      html,
    });
    console.log(`Email sent successfully! (id: ${result.id})`);
  } catch (err) {
    console.error('Failed to send email:', err.message);
    process.exit(1);
  }
}

main();
