require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');

const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const AUTH = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'product-page-new.html'), 'utf-8');

  // Extract all <style> blocks
  const styleBlocks = [];
  raw.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => { styleBlocks.push(css); });
  const allStyles = styleBlocks.join('\n');

  // Extract body content
  const bodyMatch = raw.match(/<body>([\s\S]*)<\/body>/);
  if (!bodyMatch) { console.error('No body found'); process.exit(1); }
  const bodyContent = bodyMatch[1];

  // WP header/footer hide CSS
  const wpHide = `
.page-id-431,.page-id-431 html,.page-id-431 body{overflow-x:hidden!important;margin:0!important;padding:0!important;background:#FFFFFF!important}
.page-id-431 .site-header,.page-id-431 header#masthead,.page-id-431 .entry-header,.page-id-431 .entry-title,.page-id-431 .page-header,.page-id-431 .page-title,.page-id-431 #right-sidebar,.page-id-431 #secondary,.page-id-431 .sidebar,.page-id-431 .widget-area,.page-id-431 .site-footer,.page-id-431 footer#colophon,.page-id-431 footer.site-info,.page-id-431 .navigation,.page-id-431 .nav-links,.page-id-431 .post-navigation{display:none!important}
.page-id-431 #page,.page-id-431 .site.grid-container,.page-id-431 .grid-container{max-width:100%!important;width:100%!important;padding:0!important;margin:0!important;overflow-x:hidden!important}
.page-id-431 .site-content,.page-id-431 #content,.page-id-431 .content-area,.page-id-431 #primary,.page-id-431 .site-main,.page-id-431 #main,.page-id-431 article,.page-id-431 .post-431,.page-id-431 .inside-article,.page-id-431 .entry-content{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;float:none!important;overflow-x:hidden!important}
.page-id-431.separate-containers .inside-article,.page-id-431.separate-containers .site-main>article{padding:0!important;margin:0!important;background:transparent!important;box-shadow:none!important;border:none!important}
.page-id-431.separate-containers .site-main{margin:0!important}
.page-id-431 .entry-content a{text-decoration:none;color:inherit}
.page-id-431 .entry-content a:hover{text-decoration:none}
.page-id-431 .entry-content a.btn-primary,
.page-id-431 .entry-content a.btn-secondary,
.page-id-431 .entry-content a.nav-cta,
.page-id-431 .entry-content a.plan-btn{color:#fff!important}
.page-id-431 .entry-content .final-cta a.btn-primary{color:#1d1d1f!important}
`;

  // Google Analytics
  const ga = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-TPCWJZENMQ"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-TPCWJZENMQ');
</script>`;

  const finalHtml = [
    ga,
    '<meta charset="UTF-8">',
    `<style>${wpHide}</style>`,
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">',
    `<style>${allStyles}</style>`,
    bodyContent,
  ].join('\n');

  console.log(`📄 상품 페이지 (ID: 431) 업데이트 중... (${(finalHtml.length / 1024).toFixed(1)}KB)`);

  const res = await fetch(`${WP_URL}/wp-json/wp/v2/pages/431`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${AUTH}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: `<!-- wp:html -->\n${finalHtml}\n<!-- /wp:html -->`,
      status: 'publish',
    }),
  });

  if (!res.ok) {
    console.error('❌ 실패:', await res.text());
    process.exit(1);
  }

  const page = await res.json();
  console.log(`✅ 완료! ${page.link}`);
}

main().catch(console.error);
