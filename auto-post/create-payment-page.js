const fs = require("fs");
const path = require("path");

const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;

async function main() {
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");
  const htmlContent = fs.readFileSync(
    path.join(__dirname, "payment-page.html"),
    "utf-8"
  );

  console.log("💳 결제 페이지 생성 중...");

  const pageResponse = await fetch(`${WP_URL}/wp-json/wp/v2/pages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "결제하기 - AutoPost SEO Writer",
      content: htmlContent,
      status: "publish",
      slug: "payment",
    }),
  });

  if (!pageResponse.ok) {
    const error = await pageResponse.text();
    console.error("❌ 페이지 생성 실패:", error);
    process.exit(1);
  }

  const page = await pageResponse.json();
  console.log(`✅ 결제 페이지 생성 완료!`);
  console.log(`   페이지 ID: ${page.id}`);
  console.log(`   URL: ${page.link}`);
  console.log(`\n⚠️  다음 단계:`);
  console.log(`   1. PortOne 가입: https://admin.portone.io`);
  console.log(`   2. PG사 연동 (KG이니시스/NHN KCP 등)`);
  console.log(`   3. Store ID와 Channel Key를 페이지에 입력`);
}

main().catch(console.error);
