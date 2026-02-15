/**
 * 구매 확인 이메일 HTML 템플릿
 * - Google Drive 다운로드 링크 + zip 비밀번호 방식
 */

function purchaseConfirmationHtml(data) {
  const {
    customerName = 'Customer',
    customerEmail,
    productName,
    planLabel,
    amount,
    orderId,
    purchaseDate,
    downloadUrl = '',
    downloadPassword = '',
  } = data;

  const displayName = customerName || customerEmail || 'Customer';
  const displayDate = purchaseDate || new Date().toISOString().split('T')[0];

  // 다운로드 섹션 (URL과 비밀번호가 모두 있을 때만 표시)
  let downloadSection = '';
  if (downloadUrl && downloadPassword) {
    downloadSection = `
  <!-- Download Section -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;margin:20px 0;">
    <tr><td style="padding:20px 24px;">
      <p style="margin:0 0 14px;color:#2563EB;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">상품 다운로드</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:6px 0;">
          <a href="${escapeHtml(downloadUrl)}" target="_blank" style="display:inline-block;width:100%;max-width:360px;background:#2563EB;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-size:15px;font-weight:700;text-align:center;box-sizing:border-box;">
            &#128230; 프로그램 다운로드
          </a>
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #DBEAFE;border-radius:6px;margin:14px 0 0;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;">압축 해제 비밀번호:</p>
          <p style="margin:0;color:#1e293b;font-size:18px;font-weight:700;font-family:monospace;letter-spacing:1px;">${escapeHtml(downloadPassword)}</p>
        </td></tr>
      </table>

      <p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
        * 다운로드 후 비밀번호를 입력하여 압축을 해제하세요.<br>
        * 이 비밀번호는 구매자 본인만 사용 가능합니다. 타인에게 공유하지 마세요.
      </p>
    </td></tr>
  </table>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>구매 확인 - AutoPost SEO Writer</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fa;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(37,99,235,0.08);">

<!-- Header -->
<tr>
<td style="background:linear-gradient(135deg,#2563EB 0%,#1e40af 100%);padding:32px 40px;text-align:center;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">AutoPost SEO Writer</h1>
  <p style="margin:8px 0 0;color:#BFDBFE;font-size:14px;">구매가 완료되었습니다</p>
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:36px 40px 24px;">
  <p style="margin:0 0 20px;color:#1e293b;font-size:16px;line-height:1.6;">
    안녕하세요, <strong>${escapeHtml(displayName)}</strong>님!<br>
    AutoPost SEO Writer를 구매해 주셔서 감사합니다.
  </p>

  <!-- Order Summary -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;margin:20px 0;">
    <tr>
      <td style="padding:20px 24px;">
        <p style="margin:0 0 12px;color:#2563EB;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">주문 요약</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:14px;">상품</td>
            <td style="padding:6px 0;color:#1e293b;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(productName || planLabel || 'AutoPost SEO Writer')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:14px;">플랜</td>
            <td style="padding:6px 0;color:#1e293b;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(planLabel || productName || '-')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:14px;">결제 금액</td>
            <td style="padding:6px 0;color:#2563EB;font-size:16px;text-align:right;font-weight:700;">${escapeHtml(amount || '-')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:14px;">주문 번호</td>
            <td style="padding:6px 0;color:#1e293b;font-size:13px;text-align:right;font-family:monospace;">${escapeHtml(orderId || '-')}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b;font-size:14px;">결제일</td>
            <td style="padding:6px 0;color:#1e293b;font-size:14px;text-align:right;">${escapeHtml(displayDate)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  ${downloadSection}

  <!-- Next Steps -->
  <p style="margin:24px 0 12px;color:#1e293b;font-size:15px;font-weight:600;">설치 지원 안내</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="padding:8px 0;vertical-align:top;width:28px;">
        <span style="display:inline-block;width:22px;height:22px;background:#DBEAFE;color:#2563EB;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;">1</span>
      </td>
      <td style="padding:8px 0 8px 8px;color:#475569;font-size:14px;line-height:1.5;">
        위 버튼으로 프로그램을 다운로드하고 비밀번호로 압축을 해제하세요.
      </td>
    </tr>
    <tr>
      <td style="padding:8px 0;vertical-align:top;width:28px;">
        <span style="display:inline-block;width:22px;height:22px;background:#DBEAFE;color:#2563EB;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;">2</span>
      </td>
      <td style="padding:8px 0 8px 8px;color:#475569;font-size:14px;line-height:1.5;">
        설치가 어려우시면 아래 카카오톡으로 연락해 주세요.<br>
        <strong>Zoom 원격 설치 지원</strong>을 도와드립니다.
      </td>
    </tr>
  </table>

  <!-- CTA Button -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:8px 0 16px;">
        <a href="https://open.kakao.com/o/sjcFzkei" target="_blank" style="display:inline-block;background:#FEE500;color:#191919;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;">카카오톡 상담하기</a>
      </td>
    </tr>
  </table>

  <!-- Policy Notice -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;margin:16px 0 0;">
    <tr>
      <td style="padding:14px 18px;">
        <p style="margin:0 0 6px;color:#991B1B;font-size:13px;font-weight:600;">환불 안내</p>
        <p style="margin:0;color:#7f1d1d;font-size:12px;line-height:1.6;">
          본 이메일은 결제 시 입력하신 이메일 주소(<strong>${escapeHtml(customerEmail)}</strong>)로 자동 발송되었습니다.
          이메일 발송이 완료된 시점에 프로그램에 대한 모든 권한이 구매자에게 이전되며, <strong>발송 완료 후에는 환불이 불가</strong>합니다.
          자세한 내용은 <a href="https://wpauto.kr/refund-policy/" style="color:#2563EB;text-decoration:underline;">환불 규정</a>을 확인해 주세요.
        </p>
      </td>
    </tr>
  </table>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:20px 40px 28px;border-top:1px solid #e2e8f0;text-align:center;">
  <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;">AutoPost SEO Writer — AI 블로그 자동 포스팅</p>
  <p style="margin:0;color:#94a3b8;font-size:12px;">
    <a href="https://wpauto.kr" style="color:#2563EB;text-decoration:none;">wpauto.kr</a>
  </p>
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { purchaseConfirmationHtml };
