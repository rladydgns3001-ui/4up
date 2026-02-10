const fs = require("fs");
const path = require("path");
const TelegramApproval = require("./threads-telegram");

// ============================================
// 환경 변수 로드
// ============================================
const envPath = path.join(__dirname, ".env.threads");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const [key, ...vals] = line.split("=");
  if (key && vals.length > 0) envVars[key.trim()] = vals.join("=").trim();
});

const THREADS_ACCESS_TOKEN = envVars.THREADS_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = envVars.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = envVars.TELEGRAM_CHAT_ID;

const refsPath = path.join(__dirname, "threads-viral-refs.json");

// 기본 검색 키워드 목록 (바이럴 구조/말투 수집용 — 주제 무관)
const DEFAULT_KEYWORDS = [
  "진짜",
  "요즘",
  "솔직히",
  "현실",
  "공감",
  "꿀팁",
  "후회",
  "인생",
];

// ============================================
// Threads keyword_search API 호출
// ============================================
async function searchThreads(query) {
  const fields = "id,text,timestamp,username,like_count,reply_count,repost_count,quote_count";
  const url = `https://graph.threads.net/v1.0/keyword_search?q=${encodeURIComponent(query)}&fields=${fields}&access_token=${THREADS_ACCESS_TOKEN}`;

  console.log(`🔍 검색 중: "${query}"`);

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error(`검색 실패: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.data || [];
}

// ============================================
// 인기글 필터링 (좋아요 기준 정렬)
// ============================================
function filterPopularPosts(posts, minLikes = 10) {
  return posts
    .filter((p) => (p.like_count || 0) >= minLikes && p.text && p.text.length >= 50)
    .sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
}

// ============================================
// 레퍼런스 저장소 로드/저장
// ============================================
function loadRefs() {
  try {
    return JSON.parse(fs.readFileSync(refsPath, "utf-8"));
  } catch {
    return { references: [], lastSearchAt: null };
  }
}

function saveRefs(refsData) {
  fs.writeFileSync(refsPath, JSON.stringify(refsData, null, 2));
}

// ============================================
// 중복 체크
// ============================================
function isDuplicate(refsData, postId) {
  return refsData.references.some((r) => r.id === postId);
}

// ============================================
// Telegram 승인으로 레퍼런스 저장
// ============================================
async function collectWithTelegram(posts, refsData) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("❌ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID가 .env.threads에 설정되어 있지 않습니다.");
    process.exit(1);
  }

  const telegram = new TelegramApproval(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
  let savedCount = 0;

  try {
    for (const post of posts) {
      if (isDuplicate(refsData, post.id)) {
        console.log(`⏭ 이미 저장된 글: ${post.id}`);
        continue;
      }

      const likes = post.like_count || 0;
      const replies = post.reply_count || 0;
      const reposts = post.repost_count || 0;
      const quotes = post.quote_count || 0;

      const message = [
        "📊 *바이럴 글 레퍼런스 후보*",
        "─".repeat(20),
        post.text,
        "─".repeat(20),
        `👤 @${post.username}`,
        `❤️ ${likes}  💬 ${replies}  🔄 ${reposts}  📝 ${quotes}`,
        `📅 ${post.timestamp}`,
        `📊 글자수: ${post.text.length}자`,
        "",
        "저장하시겠습니까?",
      ].join("\n");

      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 저장", callback_data: "approve" },
              { text: "⏭ 건너뛰기", callback_data: "cancel" },
            ],
            [
              { text: "🛑 수집 종료", callback_data: "stop" },
            ],
          ],
        },
        parse_mode: "Markdown",
      };

      const sent = await telegram.bot.sendMessage(telegram.chatId, message, keyboard);
      telegram._messageId = sent.message_id;

      const action = await telegram.waitForApproval(5 * 60 * 1000); // 5분 타임아웃
      await telegram.removeButtons();

      if (action === "approve") {
        refsData.references.push({
          id: post.id,
          text: post.text,
          username: post.username,
          metrics: { likes, replies, reposts, quotes },
          collectedAt: new Date().toISOString(),
        });
        saveRefs(refsData);
        savedCount++;
        await telegram.sendResult(`✅ 저장 완료 (총 ${refsData.references.length}개)`);
      } else if (action === "stop") {
        await telegram.sendResult("🛑 수집 종료");
        break;
      } else if (action === "timeout") {
        await telegram.sendResult("⏰ 타임아웃 — 수집 종료");
        break;
      } else {
        // cancel = 건너뛰기
        continue;
      }
    }

    await telegram.sendResult(
      `📊 수집 완료!\n새로 저장: ${savedCount}개\n전체 레퍼런스: ${refsData.references.length}개`
    );
  } finally {
    telegram.stop();
  }

  return savedCount;
}

// ============================================
// CLI 모드: 결과만 출력
// ============================================
function printResults(posts) {
  console.log(`\n📊 검색 결과: ${posts.length}개\n`);
  posts.forEach((post, i) => {
    console.log(`${"─".repeat(40)}`);
    console.log(`#${i + 1} | @${post.username} | ❤️ ${post.like_count || 0} 💬 ${post.reply_count || 0} 🔄 ${post.repost_count || 0}`);
    console.log(post.text);
  });
  console.log(`${"─".repeat(40)}`);
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const args = process.argv.slice(2);
  const searchIdx = args.indexOf("--search");
  const isTelegramMode = args.includes("--telegram");
  const isAutoMode = args.includes("--auto");
  const minLikesIdx = args.indexOf("--min-likes");
  const minLikes = minLikesIdx !== -1 ? parseInt(args[minLikesIdx + 1]) : 10;

  console.log("=".repeat(50));
  console.log("📊 Threads 바이럴 글 수집기");
  console.log("=".repeat(50));

  let keywords;
  if (searchIdx !== -1 && args[searchIdx + 1]) {
    keywords = [args[searchIdx + 1]];
  } else if (isAutoMode) {
    keywords = DEFAULT_KEYWORDS;
  } else {
    console.log("\n사용법:");
    console.log("  node threads-collect.js --search \"키워드\"         검색 결과 출력");
    console.log("  node threads-collect.js --search \"키워드\" --telegram  검색 + Telegram 저장 승인");
    console.log("  node threads-collect.js --auto --telegram          기본 키워드 전체 검색 + 저장");
    console.log("  node threads-collect.js --auto --min-likes 50      최소 좋아요 수 설정");
    process.exit(0);
  }

  const refsData = loadRefs();
  let allPopularPosts = [];

  for (const keyword of keywords) {
    try {
      const posts = await searchThreads(keyword);
      console.log(`  → ${posts.length}개 결과`);

      const popular = filterPopularPosts(posts, minLikes);
      console.log(`  → 인기글 ${popular.length}개 (좋아요 ${minLikes}+ 필터)`);

      allPopularPosts.push(...popular);
    } catch (err) {
      console.error(`  ❌ "${keyword}" 검색 실패:`, err.message);
    }

    // API rate limit 방지
    if (keywords.length > 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // 중복 제거 (같은 post ID)
  const seen = new Set();
  allPopularPosts = allPopularPosts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // 좋아요 순 정렬
  allPopularPosts.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));

  if (allPopularPosts.length === 0) {
    console.log("\n검색 결과가 없거나 인기글이 없습니다.");
    process.exit(0);
  }

  if (isTelegramMode) {
    await collectWithTelegram(allPopularPosts, refsData);
  } else {
    printResults(allPopularPosts);
  }

  // 마지막 검색 시각 업데이트
  refsData.lastSearchAt = new Date().toISOString();
  saveRefs(refsData);

  console.log("\n✅ 완료");
}

main().catch((err) => {
  console.error("오류 발생:", err);
  process.exit(1);
});
