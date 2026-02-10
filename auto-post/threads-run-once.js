// 단일 실행 스크립트: 사이클 순서대로 1개 글 생성 → Telegram 승인 → 발행
process.on("unhandledRejection", (err) => { console.error("UNHANDLED:", err); });

const TelegramApproval = require("./threads-telegram");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

// 환경 변수 로드
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
const contentData = JSON.parse(fs.readFileSync(contentPath, "utf-8"));
const refsData = JSON.parse(fs.readFileSync(path.join(__dirname, "threads-viral-refs.json"), "utf-8"));
const telegram = new TelegramApproval(envVars.TELEGRAM_BOT_TOKEN, envVars.TELEGRAM_CHAT_ID);

// 스포일러 마커 처리 (발행 후 앱에서 수동 적용)
function removeMarkers(text) {
  return text.replace(/\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g, (_, c) => c);
}
function getSpoilerPreview(text) {
  return text.replace(/\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g, (_, c) => `⚡【스포일러 적용】${c}【/스포일러】`);
}

async function run() {
  const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || envVars.CLAUDE_API_KEY });

  // 사이클 위치에서 카테고리 결정
  const pos = contentData.cyclePosition || 0;
  const categoryType = contentData.cycle[pos % contentData.cycle.length];
  const category = contentData.categories.find((c) => c.type === categoryType) || contentData.categories[0];

  // 순서대로 토픽 선택
  const usedTopics = contentData.postHistory.filter((h) => h.categoryType === category.type).map((h) => h.topic);
  const nextIdx = category.topics.findIndex((t) => !usedTopics.includes(t));
  const topic = nextIdx !== -1 ? category.topics[nextIdx] : category.topics[0];

  console.log(`📅 사이클 ${pos + 1}/${contentData.cycle.length}: ${categoryType}`);
  console.log(`📂 카테고리: ${category.label}`);
  console.log(`📝 토픽: ${topic}`);

  // 레퍼런스
  const refs = refsData.references;
  const refsText = refs.map((r, i) => {
    const m = r.metrics ? `(❤️${r.metrics.likes})` : "";
    return `--- ref ${i + 1} ${m} ---\n${r.text}`;
  }).join("\n\n");

  const prompt = `당신은 @wpauto.kr (오토포스트) Threads 계정 콘텐츠 작성자.

## 브랜드
- 워드프레스 AI 자동 포스팅 프로그램 "오토포스트"
- 핵심: 요즘 다들 AI로 글 쓴다면서 10~20분 걸리지? 이건 키워드 하나 넣으면 1분도 안 걸려.
- 애드센스 블로그 5년 운영자가 만듦. 광고 배치, SEO, 글 구조 전부 실전 경험.
- 월정액 없이 평생 사용. https://wpauto.kr

## 절대 금지
- 해시태그 (#으로 시작하는 태그)
- 이모지 5개 이상
- 500자 초과

## 레퍼런스 (실제 터진 글들):
${refsText}

## 학습된 바이럴 구조 패턴

### 첫줄 훅 (반드시 강렬하게)
좋은 예시:
- "AI로 글 쓴다면서 왜 아직도 20분씩 걸려?" (도발+공감)
- "블로그 글 하나에 99%가 시간 날리는 이유" (숫자+도발)
- "진짜 미쳤습니다 ㅋㅋㅋ" (감탄)
- "ChatGPT로 글 쓰는 사람 특:" (대비 구조)
절대 쓰지 마:
- "힘들지?" "바쁘지?" "요즘 어때?" → 뻔하고 궁금증 없음

### 글 구조 (택1)
A. 훅 → 공감/문제 → 해결(숨김) → 마무리
B. 훅 → 번호 리스트(일부 숨김) → 클리프행어
C. 극도 단문 질문형 (3줄, 40~80자)

### 줄바꿈
- 문장마다 빈줄 (Threads 특성상 극단적 줄바꿈이 효과적)
- 한 줄에 한 문장만

### 스포일러 마커 (중요!)
스포일러 처리할 부분은 반드시 정확히 이 형식으로:
여는태그: {{숨김}}
닫는태그: {{/숨김}}

예시: "진짜 자동화는 {{숨김}}키워드 하나 넣으면 1분{{/숨김}}이거든"
잘못된 예: "{{키워드 하나 넣으면 1분}}" ← 이렇게 쓰면 안됨!

**원칙: 사람들이 진짜 궁금해할 답/해결책만 숨겨.**
숨김 O: 해결 방법, 핵심 답변, 반전 결론, 구체적 수치
숨김 X: 문제 설명, 서론, 감정 표현
불필요하면 안 써도 됨.

## 작성
카테고리: ${category.label} (${category.type})
토픽: ${topic}

200~350자. 다체/한다체 (~이다, ~한다, ~된다, ~했다, ~있다). 이모지 0~3개.

JSON으로만 응답 (다른 텍스트 없이 JSON만):
{"text": "본문 (스포일러 부분은 {{숨김}}텍스트{{/숨김}} 형식)", "topicTag": "토픽태그"}`;

  console.log("🤖 Claude 생성 중...");
  const resp = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.content[0].text;
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  const post = JSON.parse(match[0]);
  post.text = post.text.replace(/#\S+/g, "").trim();
  post.topicTag = (post.topicTag || "블로그").replace(/^#/, "");

  // 스포일러 마커 처리
  if (post.text.includes("{{숨김}}")) {
    post.previewText = getSpoilerPreview(post.text);
    post.threadsText = removeMarkers(post.text);
    console.log("⚡ 스포일러 구간 표시됨 (발행 후 앱에서 수동 적용)");
  } else {
    post.previewText = post.text;
    post.threadsText = post.text;
  }

  console.log(`\n${"─".repeat(30)}`);
  console.log(post.previewText);
  console.log(`${"─".repeat(30)}`);
  console.log(`글자수: ${post.text.length}자\n`);

  // Telegram 전송
  console.log("📲 Telegram 전송 중...");
  await telegram.sendApprovalMessage(post);
  console.log("📲 전송 완료! 승인 대기 (5분)...");

  const action = await telegram.waitForApproval(30 * 60 * 1000); // 30분 대기
  console.log(`결과: ${action}`);

  if (action === "approve") {
    const uid = envVars.THREADS_USER_ID;
    const token = envVars.THREADS_ACCESS_TOKEN;

    // Threads 발행 (텍스트만)
    const params = { media_type: "TEXT", text: post.threadsText, access_token: token };

    const createResp = await fetch(`https://graph.threads.net/v1.0/${uid}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const createData = await createResp.json();
    if (createData.error) throw new Error(createData.error.message);
    console.log(`✅ 컨테이너: ${createData.id}`);

    await new Promise((r) => setTimeout(r, 3000));

    const pubResp = await fetch(`https://graph.threads.net/v1.0/${uid}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: createData.id, access_token: token }),
    });
    const pubData = await pubResp.json();
    if (pubData.error) throw new Error(pubData.error.message);
    console.log(`✅ 발행 완료! Post ID: ${pubData.id}`);

    await telegram.sendResult(`✅ Threads 발행 완료!\nPost ID: ${pubData.id}`);

    // 이력 저장
    contentData.cyclePosition = (pos + 1) % contentData.cycle.length;
    contentData.postHistory.push({
      categoryType: category.type,
      topic,
      topicTag: post.topicTag,
      postId: pubData.id,
      publishedAt: new Date().toISOString(),
      textLength: post.text.length,
    });
    fs.writeFileSync(contentPath, JSON.stringify(contentData, null, 2));
    console.log("📊 이력 저장 완료");
  } else if (action === "regenerate") {
    await telegram.sendResult("🔄 재생성은 Claude Code에서 다시 실행해주세요");
    console.log("🔄 재생성 요청됨 - 다시 실행 필요");
  } else {
    await telegram.sendResult("❌ 취소됨");
    console.log("❌ 취소/타임아웃");
  }

  telegram.stop();
}

run().catch((e) => {
  console.error("오류:", e);
  telegram.stop();
  process.exit(1);
});
