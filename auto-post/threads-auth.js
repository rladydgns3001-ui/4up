const APP_ID_1 = "1561451084974600";  // Facebook 앱 ID
const APP_ID_2 = "2007611389803055";  // Threads 앱 ID
const APP_SECRET_1 = "8954ac7cb841945748fe039fa3e508f7";  // Facebook 앱 시크릿
const APP_SECRET_2 = "4e83a7438180fa1a43680b88e097c80e";  // Threads 앱 시크릿
const REDIRECT_URI = "https://localhost/";

console.log("=".repeat(50));
console.log("Threads API 인증 - URL 목록");
console.log("=".repeat(50));
console.log("\n아래 URL을 하나씩 브라우저에서 열어보세요.\n");
console.log("승인 화면이 나오는 URL을 사용하면 됩니다.\n");

// 여러 조합 시도
const urls = [
  { label: "1) Facebook앱ID + 전체scope", url: `https://threads.net/oauth/authorize?client_id=${APP_ID_1}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=threads_basic,threads_content_publish,threads_keyword_search&response_type=code` },
  { label: "2) Threads앱ID + 전체scope", url: `https://threads.net/oauth/authorize?client_id=${APP_ID_2}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=threads_basic,threads_content_publish,threads_keyword_search&response_type=code` },
  { label: "3) Facebook앱ID + basic만", url: `https://threads.net/oauth/authorize?client_id=${APP_ID_1}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=threads_basic&response_type=code` },
  { label: "4) Threads앱ID + basic만", url: `https://threads.net/oauth/authorize?client_id=${APP_ID_2}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=threads_basic&response_type=code` },
];

urls.forEach(({ label, url }) => {
  console.log(`\n${label}:`);
  console.log(url);
});

console.log("\n" + "=".repeat(50));
console.log("\n승인 후 주소창의 code= 값을 복사해서 아래에 붙여넣기:");
console.log("(예: AQBxxxxx 부분만, #_ 제외)\n");

process.stdout.write("code: ");
process.stdin.resume();
process.stdin.setEncoding("utf8");

process.stdin.on("data", async (input) => {
  const code = input.trim().replace(/#_$/, "");

  if (!code) {
    console.log("코드가 비어있습니다.");
    process.exit(1);
  }

  console.log("\n토큰 교환 시도 중...");

  // 두 앱 ID 모두 시도 (각각의 시크릿 사용)
  const apps = [
    { id: APP_ID_1, secret: APP_SECRET_1 },
    { id: APP_ID_2, secret: APP_SECRET_2 },
  ];

  for (const { id: appId, secret: appSecret } of apps) {
    try {
      console.log(`\n앱 ID ${appId} 로 시도...`);

      const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
          code: code,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        console.log("실패:", tokenData.error?.message || tokenData.error_message || JSON.stringify(tokenData));
        continue;
      }

      console.log("단기 토큰 발급 성공!");

      // 장기 토큰 교환
      const longRes = await fetch(
        `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`
      );
      const longData = await longRes.json();

      if (longData.error) {
        console.log("장기 토큰 실패:", longData);
        // 단기 토큰이라도 사용
        saveCreds(appId, appSecret, tokenData.user_id, tokenData.access_token, "short");
        process.exit(0);
      }

      saveCreds(appId, appSecret, tokenData.user_id, longData.access_token, "long");

      // 프로필 테스트
      const profileRes = await fetch(
        `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${longData.access_token}`
      );
      const profile = await profileRes.json();
      console.log("프로필:", profile);

      process.exit(0);
    } catch (err) {
      console.log("오류:", err.message);
    }
  }

  console.log("\n두 앱 ID 모두 실패했습니다. 코드가 만료되었을 수 있으니 다시 시도해주세요.");
  process.exit(1);
});

function saveCreds(appId, appSecret, userId, token, type) {
  const fs = require("fs");
  console.log("\n" + "=".repeat(50));
  console.log(`토큰 발급 성공! (${type === "long" ? "60일 유효" : "1시간 유효"})`);
  console.log("=".repeat(50));
  console.log(`\nTHREADS_APP_ID=${appId}`);
  console.log(`THREADS_APP_SECRET=${appSecret}`);
  console.log(`THREADS_USER_ID=${userId}`);
  console.log(`THREADS_ACCESS_TOKEN=${token}`);

  // 기존 .env.threads에서 CLAUDE/TELEGRAM 설정 유지
  let existing = {};
  try {
    const content = fs.readFileSync("/home/user/saup/auto-post/.env.threads", "utf-8");
    content.split("\n").forEach((line) => {
      const [key, ...vals] = line.split("=");
      if (key && vals.length > 0 && !key.trim().startsWith("#")) existing[key.trim()] = vals.join("=").trim();
    });
  } catch {}

  const envContent = [
    `CLAUDE_API_KEY=${existing.CLAUDE_API_KEY || ""}`,
    "",
    `THREADS_APP_ID=${appId}`,
    `THREADS_APP_SECRET=${appSecret}`,
    `THREADS_USER_ID=${userId}`,
    `THREADS_ACCESS_TOKEN=${token}`,
    "",
    "# Telegram 봇 설정 (@BotFather에서 발급)",
    `TELEGRAM_BOT_TOKEN=${existing.TELEGRAM_BOT_TOKEN || ""}`,
    `TELEGRAM_CHAT_ID=${existing.TELEGRAM_CHAT_ID || ""}`,
    "",
  ].join("\n");
  fs.writeFileSync("/home/user/saup/auto-post/.env.threads", envContent);
  console.log("\n.env.threads 파일에 저장 완료!");
}
