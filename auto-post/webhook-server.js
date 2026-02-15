#!/usr/bin/env node
/**
 * Polar 웹훅 서버
 * - POST /webhooks/polar  → order.paid 수신 → 이메일 발송 (실패 시 자동 환불)
 * - GET  /download/:token/:filename → 토큰 검증 후 파일 다운로드 제공
 * - GET  /health → 헬스체크
 *
 * 실행: node webhook-server.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { Webhook } = require('standardwebhooks');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { purchaseConfirmationHtml } = require('./email-templates');

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;
const BASE_URL = process.env.WEBHOOK_BASE_URL || `http://localhost:${PORT}`;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'default-secret-change-me';
const DOWNLOAD_EXPIRY_DAYS = parseInt(process.env.DOWNLOAD_EXPIRY_DAYS) || 7;
const DOWNLOADS_DB = path.join(__dirname, 'downloads.json');
const PRODUCTS_DIR = path.join(__dirname, 'products');

// 상품 ID → 플랜 매핑
const PRODUCT_MAP = {
  '052ab04d-804d-44bd-89b1-d8b1f638e745': { plan: 'basic', label: 'AutoPost Basic' },
  '93bce0cc-8514-4e54-afde-5dc1b3c5cf70': { plan: 'pro', label: 'AutoPost V2 Pro' },
};

// ── 다운로드 토큰 DB ────────────────────────────────────────
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
  console.log(`[DOWNLOAD] Token created: ${token} (plan: ${plan}, expires: ${expires.toISOString()})`);
  return token;
}

function validateToken(token) {
  const db = loadDownloads();
  const entry = db[token];
  if (!entry) return null;
  if (new Date(entry.expiresAt) < new Date()) return null;
  return entry;
}

// ── 상품 파일 목록 조회 ─────────────────────────────────────
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

// ── Polar 자동 환불 ─────────────────────────────────────────
function refundOrder({ orderId, amount, reason, comment }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      order_id: orderId,
      reason: reason || 'service_disruption',
      amount,
      comment: comment || 'Auto-refund: email delivery failed',
      revoke_benefits: true,
    });

    const req = https.request(
      {
        hostname: 'api.polar.sh',
        path: '/v1/refunds/',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.POLAR_ACCESS_TOKEN}`,
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
            reject(new Error(`Polar Refund API ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Resend 이메일 발송 ─────────────────────────────────────
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

// ── 웹훅 서명 검증 ─────────────────────────────────────────
function verifyWebhook(rawBody, headers) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[WARN] POLAR_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }

  const encodedSecret = secret.startsWith('whsec_')
    ? secret
    : `whsec_${Buffer.from(secret).toString('base64')}`;

  const wh = new Webhook(encodedSecret);
  wh.verify(rawBody, {
    'webhook-id': headers['webhook-id'],
    'webhook-signature': headers['webhook-signature'],
    'webhook-timestamp': headers['webhook-timestamp'],
  });
  return true;
}

// ── order.paid 이벤트에서 데이터 추출 ───────────────────────
function extractOrderData(event) {
  const order = event.data;

  const customerEmail = order.customer?.email || order.user?.email || order.email;
  const customerName = order.customer?.name || order.user?.public_name || order.customer_name || '';

  const item = order.items?.[0] || order.product || {};
  const productId = item.product_id || order.product_id || '';
  const productInfo = PRODUCT_MAP[productId] || {};
  const productName = item.product_name || item.name || order.product_name || 'AutoPost SEO Writer';
  const planLabel = productInfo.label || productName;
  const plan = productInfo.plan || 'basic';

  const amountRaw = order.amount || order.total || item.amount || 0;
  const amount = amountRaw >= 100 ? `$${(amountRaw / 100).toFixed(0)}` : `$${amountRaw}`;

  const orderId = order.id || event.data?.id || '-';
  const purchaseDate = order.created_at
    ? new Date(order.created_at).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  return { customerName, customerEmail, productName, planLabel, plan, amount, orderId, purchaseDate };
}

// ── POST /webhooks/polar ────────────────────────────────────
app.post('/webhooks/polar', express.raw({ type: '*/*' }), async (req, res) => {
  const rawBody = req.body;

  // 1. 서명 검증
  try {
    verifyWebhook(rawBody, req.headers);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. 이벤트 파싱
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    console.error('[WEBHOOK] JSON parse error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log(`[WEBHOOK] Received event: ${event.type}`);

  // 3. order.paid 만 처리
  if (event.type !== 'order.paid') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  // 4. 데이터 추출 + 다운로드 토큰 생성 + 이메일 발송
  const data = extractOrderData(event);
  const order = event.data;

  if (!data.customerEmail) {
    console.error('[WEBHOOK] No customer email found — triggering auto-refund');
    try {
      const amountCents = order.amount || order.total || 0;
      if (amountCents > 0) {
        const refund = await refundOrder({
          orderId: data.orderId,
          amount: amountCents,
          reason: 'service_disruption',
          comment: 'Auto-refund: no customer email in order data',
        });
        console.log(`[WEBHOOK] Auto-refund processed (refund id: ${refund.id})`);
      }
    } catch (refundErr) {
      console.error('[WEBHOOK] Auto-refund FAILED:', refundErr.message);
    }
    return res.status(200).json({ received: true, error: 'no email', refunded: true });
  }

  try {
    // 다운로드 토큰 생성
    const token = createDownloadToken(data.orderId, data.plan, data.customerEmail);
    const downloadFiles = buildDownloadUrls(token, data.plan);

    const html = purchaseConfirmationHtml({ ...data, downloadFiles });
    const result = await sendEmail({
      to: data.customerEmail,
      subject: `[AutoPost] 구매 확인 — ${data.planLabel}`,
      html,
    });

    console.log(`[WEBHOOK] Email sent to ${data.customerEmail} (id: ${result.id}, downloads: ${downloadFiles.length} files)`);
    return res.status(200).json({ received: true, emailId: result.id, token });
  } catch (err) {
    // 이메일 발송 실패 → 자동 환불
    console.error(`[WEBHOOK] Email send FAILED: ${err.message} — triggering auto-refund`);
    try {
      const amountCents = order.amount || order.total || 0;
      if (amountCents > 0) {
        const refund = await refundOrder({
          orderId: data.orderId,
          amount: amountCents,
          reason: 'service_disruption',
          comment: `Auto-refund: email delivery failed to ${data.customerEmail} — ${err.message}`,
        });
        console.log(`[WEBHOOK] Auto-refund processed for ${data.customerEmail} (refund id: ${refund.id})`);
        return res.status(200).json({ received: true, error: err.message, refunded: true, refundId: refund.id });
      }
    } catch (refundErr) {
      console.error('[WEBHOOK] Auto-refund FAILED:', refundErr.message);
    }
    return res.status(200).json({ received: true, error: err.message, refundAttempted: true });
  }
});

// ── GET /download/:token/:filename ──────────────────────────
app.get('/download/:token/:filename', (req, res) => {
  const { token, filename } = req.params;

  // 토큰 검증
  const entry = validateToken(token);
  if (!entry) {
    return res.status(403).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">
        <h2 style="color:#991B1B;">다운로드 링크가 만료되었거나 유효하지 않습니다.</h2>
        <p style="color:#666;">링크 유효기간: ${DOWNLOAD_EXPIRY_DAYS}일</p>
        <p>문의: <a href="https://open.kakao.com/o/sjcFzkei" style="color:#2563EB;">카카오톡 오픈채팅</a></p>
      </body></html>
    `);
  }

  // 경로 순회 공격 방지
  const safeName = path.basename(filename);
  const filePath = path.join(PRODUCTS_DIR, entry.plan, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">
        <h2 style="color:#991B1B;">파일을 찾을 수 없습니다.</h2>
        <p>문의: <a href="https://open.kakao.com/o/sjcFzkei" style="color:#2563EB;">카카오톡 오픈채팅</a></p>
      </body></html>
    `);
  }

  console.log(`[DOWNLOAD] Serving ${safeName} to ${entry.email} (plan: ${entry.plan}, token: ${token.slice(0, 8)}...)`);
  res.download(filePath, safeName);
});

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const db = loadDownloads();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    activeTokens: Object.keys(db).length,
  });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[WEBHOOK] Server running on port ${PORT}`);
  console.log(`[WEBHOOK] Base URL: ${BASE_URL}`);
  console.log(`[WEBHOOK] Endpoints:`);
  console.log(`  POST /webhooks/polar`);
  console.log(`  GET  /download/:token/:filename`);
  console.log(`  GET  /health`);
  console.log(`[WEBHOOK] Products dir: ${PRODUCTS_DIR}`);

  // 상품 파일 확인
  ['basic', 'pro'].forEach(plan => {
    const files = getProductFiles(plan);
    if (files.length === 0) {
      console.warn(`[WARN] No files in products/${plan}/ — 파일을 넣어주세요`);
    } else {
      console.log(`  ${plan}: ${files.join(', ')}`);
    }
  });
});
