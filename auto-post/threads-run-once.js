// 단일 실행 스크립트: 성과 분석 → 사이클 순서대로 1개 글 생성 → 이미지 첨부 → 즉시 자동 발행
process.on("unhandledRejection", (err) => { console.error("UNHANDLED:", err); });

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const imagesDir = path.join(__dirname, "threads-images");

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
try {
  const wpContent = fs.readFileSync(path.join(__dirname, ".env"), "utf-8");
  wpContent.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length > 0 && !(key.trim() in envVars)) envVars[key.trim()] = vals.join("=").trim();
  });
} catch {}

const contentPath = path.join(__dirname, "threads-content.json");
const insightsPath = path.join(__dirname, "threads-insights.json");
const refsPath = path.join(__dirname, "threads-viral-refs.json");
const contentData = JSON.parse(fs.readFileSync(contentPath, "utf-8"));
const refsData = JSON.parse(fs.readFileSync(refsPath, "utf-8"));

// Telegram은 알림용으로만 사용 (승인 X)
let telegram = null;
try {
  const TelegramApproval = require("./threads-telegram");
  if (envVars.TELEGRAM_BOT_TOKEN && envVars.TELEGRAM_CHAT_ID) {
    telegram = new TelegramApproval(envVars.TELEGRAM_BOT_TOKEN, envVars.TELEGRAM_CHAT_ID);
  }
} catch {}

// ============================================
// Threads Insights API — 과거 글 성과 수집
// ============================================
async function fetchPostInsights(postId, token) {
  try {
    const url = `https://graph.threads.net/v1.0/${postId}/insights?metric=views,likes,replies,reposts,quotes&access_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) {
      console.log(`  ⚠️ ${postId} insights 실패: ${data.error.message}`);
      return null;
    }
    const metrics = {};
    (data.data || []).forEach((m) => {
      metrics[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
    });
    return metrics;
  } catch (e) {
    console.log(`  ⚠️ ${postId} insights 오류: ${e.message}`);
    return null;
  }
}

async function collectInsights(token) {
  // 기존 insights 로드
  let insights = { posts: [], lastCollectedAt: null };
  try {
    insights = JSON.parse(fs.readFileSync(insightsPath, "utf-8"));
  } catch {}

  const existingIds = new Set(insights.posts.map((p) => p.postId));
  const postsToCheck = contentData.postHistory.filter((h) => h.postId);

  console.log(`📊 성과 수집: ${postsToCheck.length}개 글 체크 중...`);
  let updated = 0;

  for (const hist of postsToCheck) {
    const metrics = await fetchPostInsights(hist.postId, token);
    if (!metrics) continue;

    const entry = {
      postId: hist.postId,
      categoryType: hist.categoryType,
      topic: hist.topic,
      topicTag: hist.topicTag,
      textLength: hist.textLength,
      publishedAt: hist.publishedAt,
      ...metrics,
      collectedAt: new Date().toISOString(),
    };

    // 기존 데이터 업데이트 또는 추가
    const idx = insights.posts.findIndex((p) => p.postId === hist.postId);
    if (idx !== -1) {
      insights.posts[idx] = entry;
    } else {
      insights.posts.push(entry);
    }
    updated++;
  }

  insights.lastCollectedAt = new Date().toISOString();
  fs.writeFileSync(insightsPath, JSON.stringify(insights, null, 2));
  console.log(`📊 성과 수집 완료: ${updated}개 업데이트됨`);
  return insights;
}

// ============================================
// 성과 분석 — 터지는 글 vs 안 터지는 글
// ============================================
function analyzePerformance(insights) {
  const posts = insights.posts || [];
  if (posts.length < 2) return null;

  // views 기준 정렬
  const sorted = [...posts].filter((p) => p.views > 0).sort((a, b) => b.views - a.views);
  if (sorted.length < 2) return null;

  const topHalf = sorted.slice(0, Math.ceil(sorted.length / 2));
  const bottomHalf = sorted.slice(Math.ceil(sorted.length / 2));

  const avg = (arr, key) => arr.length ? Math.round(arr.reduce((s, p) => s + (p[key] || 0), 0) / arr.length) : 0;

  const analysis = {
    totalPosts: posts.length,
    top: {
      count: topHalf.length,
      avgViews: avg(topHalf, "views"),
      avgLikes: avg(topHalf, "likes"),
      avgReplies: avg(topHalf, "replies"),
      avgReposts: avg(topHalf, "reposts"),
      avgTextLength: avg(topHalf, "textLength"),
      categories: topHalf.map((p) => p.categoryType),
      topics: topHalf.map((p) => p.topic),
    },
    bottom: {
      count: bottomHalf.length,
      avgViews: avg(bottomHalf, "views"),
      avgLikes: avg(bottomHalf, "likes"),
      avgReplies: avg(bottomHalf, "replies"),
      avgReposts: avg(bottomHalf, "reposts"),
      avgTextLength: avg(bottomHalf, "textLength"),
      categories: bottomHalf.map((p) => p.categoryType),
      topics: bottomHalf.map((p) => p.topic),
    },
    bestPost: sorted[0] || null,
    worstPost: sorted[sorted.length - 1] || null,
  };

  return analysis;
}

function buildPerformanceFeedback(analysis) {
  if (!analysis) return "";

  let feedback = `\n\n## 과거 성과 분석 (${analysis.totalPosts}개 글 기반)\n`;

  feedback += `\n### 잘 되는 글 (상위 ${analysis.top.count}개):\n`;
  feedback += `- 평균 조회수: ${analysis.top.avgViews}, 좋아요: ${analysis.top.avgLikes}, 댓글: ${analysis.top.avgReplies}, 리포스트: ${analysis.top.avgReposts}\n`;
  feedback += `- 평균 글자수: ${analysis.top.avgTextLength}자\n`;
  feedback += `- 카테고리: ${[...new Set(analysis.top.categories)].join(", ")}\n`;

  feedback += `\n### 안 되는 글 (하위 ${analysis.bottom.count}개):\n`;
  feedback += `- 평균 조회수: ${analysis.bottom.avgViews}, 좋아요: ${analysis.bottom.avgLikes}, 댓글: ${analysis.bottom.avgReplies}, 리포스트: ${analysis.bottom.avgReposts}\n`;
  feedback += `- 평균 글자수: ${analysis.bottom.avgTextLength}자\n`;

  if (analysis.bestPost) {
    feedback += `\n### 베스트 글:\n`;
    feedback += `- 토픽: "${analysis.bestPost.topic}" (조회 ${analysis.bestPost.views}, 좋아요 ${analysis.bestPost.likes}, 댓글 ${analysis.bestPost.replies})\n`;
    feedback += `- 글자수: ${analysis.bestPost.textLength}자, 카테고리: ${analysis.bestPost.categoryType}\n`;
  }

  if (analysis.worstPost) {
    feedback += `\n### 최하 글:\n`;
    feedback += `- 토픽: "${analysis.worstPost.topic}" (조회 ${analysis.worstPost.views}, 좋아요 ${analysis.worstPost.likes}, 댓글 ${analysis.worstPost.replies})\n`;
    feedback += `- 글자수: ${analysis.worstPost.textLength}자, 카테고리: ${analysis.worstPost.categoryType}\n`;
  }

  feedback += `\n### 지시사항:\n`;
  feedback += `- 베스트 글의 구조와 톤을 참고해서 글을 작성해라.\n`;
  feedback += `- 최하 글의 패턴은 피해라.\n`;

  if (analysis.top.avgTextLength > analysis.bottom.avgTextLength + 30) {
    feedback += `- 데이터상 긴 글(${analysis.top.avgTextLength}자)이 더 잘 된다.\n`;
  } else if (analysis.top.avgTextLength < analysis.bottom.avgTextLength - 30) {
    feedback += `- 데이터상 짧은 글(${analysis.top.avgTextLength}자)이 더 잘 된다.\n`;
  }

  if (analysis.top.avgReplies > analysis.top.avgLikes * 0.3) {
    feedback += `- 댓글 비율이 높은 글이 잘 된다. 질문/논쟁을 유도하는 구조를 써라.\n`;
  }

  return feedback;
}

// ============================================
// 스포일러 마커 처리
// ============================================
function removeMarkers(text) {
  return text.replace(/\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g, (_, c) => c);
}
function getSpoilerPreview(text) {
  return text.replace(/\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g, (_, c) => `⚡【스포일러 적용】${c}【/스포일러】`);
}

// ============================================
// WordPress 미디어 업로드 + 이미지 선택
// ============================================
async function uploadToWordPress(filePath) {
  const WP_URL = envVars.WP_URL;
  const WP_USER = envVars.WP_USER;
  const WP_APP_PASSWORD = envVars.WP_APP_PASSWORD;
  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    console.log("⚠️ WordPress 인증 정보 없음, 이미지 스킵");
    return null;
  }
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : ext === ".mp4" ? "video/mp4" : "image/jpeg";
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");
  const response = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "Content-Type": mimeType,
    },
    body: fileBuffer,
  });
  const data = await response.json();
  if (data.source_url) {
    console.log(`📸 이미지 업로드 완료: ${data.source_url}`);
    return data.source_url;
  }
  console.log("⚠️ 이미지 업로드 실패:", data.message || JSON.stringify(data));
  return null;
}

function selectMedia(categoryType) {
  const categoryMediaMap = {
    empathy: ["homepage.png", "product-thumbnail.png"],
    blog_tips: ["homepage.png", "product-thumbnail.png"],
    seo_adsense: ["homepage.png", "product-thumbnail.png"],
    product_promo: ["program-screenshot-1.png", "program-screenshot-2.png", "product-thumbnail.png"],
    user_reviews: ["program-screenshot-1.png", "program-screenshot-2.png", "homepage.png"],
    wordpress_tips: ["homepage.png", "product-thumbnail.png"],
  };
  const candidates = categoryMediaMap[categoryType] || ["homepage.png", "product-thumbnail.png"];
  const available = candidates.filter((name) => fs.existsSync(path.join(imagesDir, name)));
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    return path.join(imagesDir, pick);
  }
  // fallback: 디렉토리 내 아무 이미지
  try {
    const files = fs.readdirSync(imagesDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
    if (files.length > 0) return path.join(imagesDir, files[Math.floor(Math.random() * files.length)]);
  } catch {}
  console.log("⚠️ 사용 가능한 미디어 없음 — 텍스트만 발행");
  return null;
}

// ============================================
// 메인 실행
// ============================================
async function run() {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || envVars.CLAUDE_API_KEY });
  const token = envVars.THREADS_ACCESS_TOKEN;
  const uid = envVars.THREADS_USER_ID;

  // 1. 과거 글 성과 수집
  let performanceFeedback = "";
  try {
    const insights = await collectInsights(token);
    const analysis = analyzePerformance(insights);
    performanceFeedback = buildPerformanceFeedback(analysis);
    if (analysis) {
      console.log(`📈 베스트 조회수: ${analysis.bestPost?.views || 0}, 최하 조회수: ${analysis.worstPost?.views || 0}`);
    }
  } catch (e) {
    console.log(`⚠️ 성과 수집 스킵: ${e.message}`);
  }

  // 2. 사이클 위치에서 카테고리 결정
  const pos = contentData.cyclePosition || 0;
  const categoryType = contentData.cycle[pos % contentData.cycle.length];
  const category = contentData.categories.find((c) => c.type === categoryType) || contentData.categories[0];

  // 3. 순서대로 토픽 선택
  const usedTopics = contentData.postHistory.filter((h) => h.categoryType === category.type).map((h) => h.topic);
  let nextIdx = category.topics.findIndex((t) => !usedTopics.includes(t));
  // 모든 토픽 사용 시 해당 카테고리 히스토리 초기화
  if (nextIdx === -1) {
    contentData.postHistory = contentData.postHistory.filter((h) => h.categoryType !== category.type);
    nextIdx = 0;
    console.log(`🔄 ${category.label} 카테고리 토픽 리셋`);
  }
  const topic = category.topics[nextIdx];

  console.log(`📅 사이클 ${pos + 1}/${contentData.cycle.length}: ${categoryType}`);
  console.log(`📂 카테고리: ${category.label}`);
  console.log(`📝 토픽: ${topic}`);

  // 4. 레퍼런스
  const refs = refsData.references || [];
  const shuffled = [...refs].sort(() => Math.random() - 0.5);
  const selectedRefs = shuffled.slice(0, 5);
  const refsText = selectedRefs.map((r, i) => {
    const m = r.metrics ? `(❤️${r.metrics.likes} 💬${r.metrics.replies})` : "";
    return `--- ref ${i + 1} ${m} ---\n${r.text}`;
  }).join("\n\n");

  // 5. Claude 프롬프트 (성과 분석 + 데이터 기반 최적화)
  const prompt = `당신은 @wpauto.kr (오토포스트) Threads 계정 콘텐츠 작성자.

## 브랜드
- 워드프레스 AI 자동 포스팅 프로그램 "오토포스트"
- 핵심: 요즘 다들 AI로 글 쓴다면서 10~20분 걸리지? 이건 키워드 하나 넣으면 1분도 안 걸려.
- 애드센스 블로그 5년 운영자가 만듦. 광고 배치, SEO, 글 구조 전부 실전 경험.
- 월정액 없이 평생 사용. https://wpauto.kr

## 절대 금지
- 해시태그 (#으로 시작하는 태그)
- 이모지 5개 이상
- 300자 초과 (100~200자가 가장 효과적. 데이터 기반.)

## 레퍼런스 (실제 터진 글들):
${refsText}

## 실제 데이터 기반 바이럴 패턴 (54개 게시물 분석 결과)

### 최고 성과 게시물 (반드시 참고):
1위(1,933조회): "AI로 글 쓴다면서 왜 아직도 10분씩 걸려?" → 공감+불만 자극형
2위(1,767조회): "ChatGPT로 글 쓰는 사람 특:" → 대비 구조형
공통점: 독자의 현재 불편함을 직접 지적하는 도입부

### 첫줄 훅 (반드시 강렬하게, 아래 패턴 활용)
최고 성과 패턴:
- "~하는 사람 특:" (대비 구조, 조회수 최고)
- "아직도 ~한다고?" / "왜 아직도 ~?" (도발+공감)
- "~하는 사람 99%가 모르는 것" (숫자+도발)
- "진짜 미쳤습니다 ㅋㅋㅋ" (감탄)
절대 쓰지 마 (조회수 최하위 패턴):
- "힘들지?" "바쁘지?" "요즘 어때?" → 뻔하고 궁금증 없음
- 부드러운 위로 톤 → 스크롤 멈춤 효과 없음

### 글 구조 (택1)
A. 훅 → 공감/문제 → 해결(숨김) → 마무리 (100~200자)
B. 훅 → 번호 리스트(일부 숨김) → 클리프행어 (150~250자)
C. 극도 단문 질문형 (3줄, 40~80자) — 댓글 비율 극대화

### 줄바꿈
- 문장마다 빈줄 (Threads 특성상 극단적 줄바꿈이 효과적)
- 한 줄에 한 문장만

### 스포일러 마커 (중요!)
여는태그: {{숨김}}  닫는태그: {{/숨김}}
예시: "진짜 자동화는 {{숨김}}키워드 하나 넣으면 1분{{/숨김}}이거든"
**원칙: 답변/해결책/반전만 숨겨. 문제 설명이나 서론은 숨기지 마.**
불필요하면 안 써도 됨.

### 참여 유도 (데이터 기반)
- 질문/논쟁 유도형 글이 참여율 6.64% 달성 (평균 1.74%)
- 마지막 줄에 질문 넣으면 댓글 2~3배 증가
${performanceFeedback}
## 작성
카테고리: ${category.label} (${category.type})
토픽: ${topic}

**100~200자 목표.** 짧을수록 조회수 높음. 다체/한다체 (~이다, ~한다, ~된다). 이모지 0~2개.

JSON으로만 응답 (다른 텍스트 없이 JSON만):
{"text": "본문 (스포일러 부분은 {{숨김}}텍스트{{/숨김}} 형식)", "topicTag": "토픽태그"}`;

  // 6. Claude 생성
  console.log("🤖 Claude 생성 중...");
  const resp = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.content[0].text;
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude JSON 파싱 실패: " + raw.substring(0, 200));
  const post = JSON.parse(match[0]);
  post.text = post.text.replace(/#\S+/g, "").trim();
  post.topicTag = (post.topicTag || "블로그").replace(/^#/, "");

  // 스포일러 마커 처리
  if (post.text.includes("{{숨김}}")) {
    post.previewText = getSpoilerPreview(post.text);
    post.threadsText = removeMarkers(post.text);
    console.log("⚡ 스포일러 구간 표시됨");
  } else {
    post.previewText = post.text;
    post.threadsText = post.text;
  }

  console.log(`\n${"─".repeat(30)}`);
  console.log(post.previewText);
  console.log(`${"─".repeat(30)}`);
  console.log(`글자수: ${post.threadsText.length}자\n`);

  // 7. 이미지 선택 + WordPress 업로드 + Threads 발행
  let mediaUrl = null;
  let mediaType = "TEXT";
  const mediaPath = selectMedia(categoryType);
  if (mediaPath) {
    const isVideo = mediaPath.endsWith(".mp4");
    console.log(`📸 미디어 선택: ${path.basename(mediaPath)} (${isVideo ? "영상" : "이미지"})`);
    mediaUrl = await uploadToWordPress(mediaPath);
    if (mediaUrl) mediaType = isVideo ? "VIDEO" : "IMAGE";
  }

  console.log("📤 Threads 자동 발행 중...");
  const params = { media_type: mediaType, text: post.threadsText, access_token: token };
  if (mediaUrl && mediaType === "IMAGE") params.image_url = mediaUrl;
  if (mediaUrl && mediaType === "VIDEO") params.video_url = mediaUrl;

  const createResp = await fetch(`https://graph.threads.net/v1.0/${uid}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const createData = await createResp.json();
  if (createData.error) throw new Error(`컨테이너 생성 실패: ${createData.error.message}`);
  console.log(`✅ 컨테이너: ${createData.id}`);

  await new Promise((r) => setTimeout(r, 3000));

  const pubResp = await fetch(`https://graph.threads.net/v1.0/${uid}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: createData.id, access_token: token }),
  });
  const pubData = await pubResp.json();
  if (pubData.error) throw new Error(`발행 실패: ${pubData.error.message}`);
  console.log(`✅ 발행 완료! Post ID: ${pubData.id}`);

  // 8. Telegram 알림 (승인 아님, 결과 알림만)
  if (telegram) {
    try {
      const notifyMsg = [
        "📱 *Threads 자동 발행 완료*",
        "─".repeat(20),
        post.previewText,
        "─".repeat(20),
        `🏷 #${post.topicTag}`,
        `📊 ${post.threadsText.length}자`,
        `🆔 ${pubData.id}`,
        `📅 ${categoryType} → ${topic}`,
      ].join("\n");
      await telegram.sendResult(notifyMsg);
    } catch (e) {
      console.log(`⚠️ Telegram 알림 실패: ${e.message}`);
    }
    telegram.stop();
  }

  // 9. 이력 저장
  contentData.cyclePosition = (pos + 1) % contentData.cycle.length;
  contentData.postHistory.push({
    categoryType: category.type,
    topic,
    topicTag: post.topicTag,
    postId: pubData.id,
    publishedAt: new Date().toISOString(),
    textLength: post.threadsText.length,
    mediaType: mediaType,
    hasMedia: mediaUrl !== null,
  });
  fs.writeFileSync(contentPath, JSON.stringify(contentData, null, 2));
  console.log("📊 이력 저장 완료");
}

run().catch((e) => {
  console.error("오류:", e);
  // 오류 발생 시에도 Telegram 알림
  if (telegram) {
    telegram.sendResult(`❌ Threads 자동 발행 오류:\n${e.message}`).catch(() => {});
    setTimeout(() => telegram.stop(), 2000);
  }
  process.exit(1);
});
