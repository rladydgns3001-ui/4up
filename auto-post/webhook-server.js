#!/usr/bin/env node
/**
 * Polar 웹훅 서버
 * - POST /webhooks/polar → order.paid 수신 → Resend 이메일 발송 (실패 시 자동 환불)
 * - GET  /health → 헬스체크
 *
 * 실행: node webhook-server.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { Webhook } = require('standardwebhooks');
const https = require('https');
const { purchaseConfirmationHtml } = require('./email-templates');

const app = express();
const PORT = process.env.WEBHOOK_PORT || 3000;

// 상품 ID → 플랜 매핑
const PRODUCT_MAP = {
  '052ab04d-804d-44bd-89b1-d8b1f638e745': { plan: 'basic', label: 'AutoPost Basic' },
  '93bce0cc-8514-4e54-afde-5dc1b3c5cf70': { plan: 'pro', label: 'AutoPost V2 Pro' },
};

// 플랜별 다운로드 정보 (.env에서 읽기)
const PLAN_DOWNLOADS = {
  basic: {
    url: process.env.DOWNLOAD_URL_BASIC || '',
    password: process.env.DOWNLOAD_PASSWORD_BASIC || '',
    manualUrl: process.env.MANUAL_URL_BASIC || '',
  },
  pro: {
    url: process.env.DOWNLOAD_URL_PRO || '',
    password: process.env.DOWNLOAD_PASSWORD_PRO || '',
    manualUrl: process.env.MANUAL_URL_PRO || '',
  },
};

// ── 환경변수 검증 ──────────────────────────────────────────
function validateEnv() {
  const errors = [];
  const warnings = [];

  if (!process.env.RESEND_API_KEY) {
    errors.push('RESEND_API_KEY — Resend API 키 누락. 이메일 발송 불가.');
  } else if (!process.env.RESEND_API_KEY.startsWith('re_')) {
    errors.push('RESEND_API_KEY — 유효하지 않은 형식 (re_ 로 시작해야 함).');
  }

  if (!process.env.RESEND_FROM) {
    errors.push('RESEND_FROM — 발신자 이메일 누락.');
  }

  if (!process.env.POLAR_ACCESS_TOKEN) {
    errors.push('POLAR_ACCESS_TOKEN — Polar API 토큰 누락. 자동 환불 불가.');
  } else if (!process.env.POLAR_ACCESS_TOKEN.startsWith('polar_')) {
    errors.push('POLAR_ACCESS_TOKEN — 유효하지 않은 형식 (polar_ 로 시작해야 함).');
  }

  if (!process.env.POLAR_WEBHOOK_SECRET) {
    warnings.push('POLAR_WEBHOOK_SECRET — 미설정. 웹훅 서명 검증이 비활성화됩니다.');
  }

  if (!process.env.DOWNLOAD_URL_BASIC) {
    warnings.push('DOWNLOAD_URL_BASIC — Basic 플랜 다운로드 URL 미설정.');
  }
  if (!process.env.DOWNLOAD_URL_PRO) {
    warnings.push('DOWNLOAD_URL_PRO — Pro 플랜 다운로드 URL 미설정.');
  }
  if (!process.env.DOWNLOAD_PASSWORD_BASIC) {
    warnings.push('DOWNLOAD_PASSWORD_BASIC — Basic 플랜 zip 비밀번호 미설정.');
  }
  if (!process.env.DOWNLOAD_PASSWORD_PRO) {
    warnings.push('DOWNLOAD_PASSWORD_PRO — Pro 플랜 zip 비밀번호 미설정.');
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  경고:');
    warnings.forEach(w => console.warn(`   ${w}`));
  }

  if (errors.length > 0) {
    console.error('\n❌ 필수 환경변수 오류:');
    errors.forEach(e => console.error(`   ${e}`));
    console.error('\n   .env 파일을 확인하세요.');
    console.error('   서버를 시작할 수 없습니다.\n');
    process.exit(1);
  }

  if (warnings.length === 0) {
    console.log('✅ 환경변수 검증 통과');
  }
  console.log('');
}

validateEnv();

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

  // 플랜별 다운로드 정보
  const download = PLAN_DOWNLOADS[plan] || {};

  return {
    customerName, customerEmail, productName, planLabel, plan,
    amount, orderId, purchaseDate,
    downloadUrl: download.url,
    downloadPassword: download.password,
    manualUrl: download.manualUrl,
  };
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

  // 4. 데이터 추출 + 이메일 발송 (실패 시 자동 환불)
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
    const html = purchaseConfirmationHtml(data);
    const result = await sendEmail({
      to: data.customerEmail,
      subject: `[AutoPost] 구매 확인 — ${data.planLabel}`,
      html,
    });

    console.log(`[WEBHOOK] Email sent to ${data.customerEmail} (id: ${result.id})`);
    return res.status(200).json({ received: true, emailId: result.id });
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

// ── Health check ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[WEBHOOK] Server running on port ${PORT}`);
  console.log(`[WEBHOOK] Endpoints:`);
  console.log(`  POST /webhooks/polar`);
  console.log(`  GET  /health`);
});
