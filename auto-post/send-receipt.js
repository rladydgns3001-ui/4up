#!/usr/bin/env node
/**
 * 수동 구매 확인 이메일 발송 (다운로드 링크 포함)
 *
 * Usage:
 *   node send-receipt.js --email buyer@example.com --plan pro
 *   node send-receipt.js --email buyer@example.com --plan basic --name "홍길동"
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { purchaseConfirmationHtml } = require('./email-templates');

const BASE_URL = process.env.WEBHOOK_BASE_URL || `http://localhost:${process.env.WEBHOOK_PORT || 3000}`;
const DOWNLOAD_EXPIRY_DAYS = parseInt(process.env.DOWNLOAD_EXPIRY_DAYS) || 7;
const DOWNLOADS_DB = path.join(__dirname, 'downloads.json');
const PRODUCTS_DIR = path.join(__dirname, 'products');

const PLANS = {
  basic: {
    productName: 'AutoPost Basic',
    planLabel: 'AutoPost Basic',
    amount: '$199',
  },
  pro: {
    productName: 'AutoPost V2 Pro',
    planLabel: 'AutoPost V2 Pro',
    amount: '$269',
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

function loadDownloads() {
  try {
    return JSON.parse(fs.readFileSync(DOWNLOADS_DB, 'utf-8'));
  } catch {
    return {};
  }
}

function saveDownloads(db) {
  fs.writeFileSync(DOWNLOADS_DB, JSON.stringify(db, null, 2));
}

function createDownloadToken(orderId, plan, email) {
  const token = crypto.randomUUID();
  const db = loadDownloads();
  const now = new Date();
  const expires = new Date(now.getTime() + DOWNLOAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  db[token] = {
    orderId,
    plan,
    email,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  saveDownloads(db);
  return token;
}

function getProductFiles(plan) {
  const dir = path.join(PRODUCTS_DIR, plan);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => !f.startsWith('.'));
}

function buildDownloadUrls(token, plan) {
  const files = getProductFiles(plan);
  return files.map(filename => ({
    filename,
    url: `${BASE_URL}/download/${token}/${filename}`,
    isZip: /\.zip$/i.test(filename),
    isPdf: /\.pdf$/i.test(filename),
  }));
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

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not found in .env');
    process.exit(1);
  }

  const planInfo = PLANS[plan];
  const orderId = `manual-${Date.now()}`;

  // 다운로드 토큰 생성
  const token = createDownloadToken(orderId, plan, email);
  const downloadFiles = buildDownloadUrls(token, plan);

  if (downloadFiles.length === 0) {
    console.warn(`WARNING: No files in products/${plan}/ — 이메일에 다운로드 링크가 포함되지 않습니다.`);
  } else {
    console.log(`Download files (${plan}):`, downloadFiles.map(f => f.filename).join(', '));
  }

  const data = {
    customerName: name || email.split('@')[0],
    customerEmail: email,
    productName: planInfo.productName,
    planLabel: planInfo.planLabel,
    amount: planInfo.amount,
    orderId,
    purchaseDate: new Date().toISOString().split('T')[0],
    downloadFiles,
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
    if (downloadFiles.length > 0) {
      console.log(`Download token: ${token}`);
      console.log(`Download links:`);
      downloadFiles.forEach(f => console.log(`  ${f.filename}: ${f.url}`));
    }
  } catch (err) {
    console.error('Failed to send email:', err.message);
    process.exit(1);
  }
}

main();
