const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const TelegramApproval = require("./threads-telegram");

// ============================================
// 환경 변수 로드
// ============================================
// CLAUDE_API_KEY: 환경변수 우선, 없으면 .env.threads에서 로드

// .env.threads 파일에서 Threads 인증 정보 로드
const envPath = path.join(__dirname, ".env.threads");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const [key, ...vals] = line.split("=");
  if (key && vals.length > 0) envVars[key.trim()] = vals.join("=").trim();
});

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || envVars.CLAUDE_API_KEY;
const THREADS_USER_ID = envVars.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = envVars.THREADS_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = envVars.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = envVars.TELEGRAM_CHAT_ID;

const contentPath = path.join(__dirname, "threads-content.json");
const readline = require("readline");

// ============================================
// 사용자 입력 받기 (승인 프로세스용)
// ============================================
function askUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ============================================
// 멀티라인 입력 받기 (직접 수정용)
// ============================================
function readMultilineInput() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const lines = [];
    let emptyCount = 0;
    rl.on("line", (line) => {
      if (line === "") {
        emptyCount++;
        if (emptyCount >= 2) {
          rl.close();
          resolve(lines.join("\n").trim());
          return;
        }
      } else {
        // 빈줄 카운트 리셋, 중간 빈줄은 유지
        if (emptyCount === 1) lines.push("");
        emptyCount = 0;
      }
      if (emptyCount < 2) lines.push(line);
    });
    rl.on("close", () => {
      resolve(lines.join("\n").trim());
    });
  });
}

// ============================================
// 1. 가중치 기반 카테고리 선택
// ============================================
function selectCategory(contentData) {
  const { categories, postHistory, lastCategoryIndex } = contentData;

  // 가중치 기반 확률 계산
  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  let selectedIndex = 0;
  for (let i = 0; i < categories.length; i++) {
    random -= categories[i].weight;
    if (random <= 0) {
      selectedIndex = i;
      break;
    }
  }

  // 직전과 같은 카테고리면 다음으로 이동 (연속 방지)
  if (selectedIndex === lastCategoryIndex && categories.length > 1) {
    selectedIndex = (selectedIndex + 1) % categories.length;
  }

  return selectedIndex;
}

// ============================================
// 2. 토픽 선택 (중복 방지)
// ============================================
function selectTopic(category, postHistory) {
  const usedTopics = postHistory
    .filter((h) => h.categoryType === category.type)
    .map((h) => h.topic);

  const availableTopics = category.topics.filter(
    (t) => !usedTopics.includes(t)
  );

  // 모든 토픽을 다 사용했으면 히스토리에서 해당 카테고리 기록 초기화
  if (availableTopics.length === 0) {
    return {
      topic: category.topics[Math.floor(Math.random() * category.topics.length)],
      resetHistory: true,
    };
  }

  return {
    topic: availableTopics[Math.floor(Math.random() * availableTopics.length)],
    resetHistory: false,
  };
}

// ============================================
// 3. Claude API로 Threads 최적화 글 생성
// ============================================
async function generateThreadsPost(category, topic) {
  const client = new Anthropic({ apiKey: CLAUDE_API_KEY });

  const systemPrompt = `당신은 @wpauto.kr (오토포스트) Threads 계정의 콘텐츠 작성자입니다.

## 브랜드 정보
- 제품: 워드프레스 AI 자동 포스팅 프로그램 "오토포스트"
- 핵심 메시지: AI로 글 쓴다면서 10분 20분 걸리지? 이건 키워드 하나 넣으면 1분도 안 걸려. 발행까지 원클릭.
- 만든 사람: 애드센스 블로그 5년 운영자. 광고 배치, SEO, 글 구조 전부 실전 경험에서 나온 결과물.
- 차별점: 글 퀄리티가 높음 (프롬프트 수정 필요 없음), 전면광고 배치 자동 최적화, SEO 구조 자동 적용
- 가격: 월정액 없이 한번 구매로 평생 사용
- 문의/구매: https://wpauto.kr (카카오톡 문의, Threads 연락 가능)

## Threads 알고리즘 최적화 규칙 (필수)
1. 첫 줄 = 검색 키워드 역할 (구글이 Threads를 인덱싱함)
2. 구어체 사용 ("~거든", "~더라고", "~해봤는데", "~잖아")
3. 반말 톤 사용 (친근한 느낌)
4. 질문형 마무리 필수 (댓글 유도 = 알고리즘 핵심 신호)
5. 글자수 200~400자 (너무 짧으면 가치 부족, 너무 길면 이탈)
6. 이모지 적절히 사용 (2~4개, Threads는 이모지 친화적)
7. 줄바꿈으로 가독성 확보 (2~3줄마다 줄바꿈)
8. 해시태그 없음 (토픽태그는 별도 필드로 처리)

## 카테고리별 작성 가이드

### empathy (공감/동기부여) — 가장 중요
- "나도 그랬어" 톤으로 고충 공감
- ChatGPT로 글 써도 10~20분 걸리는 현실, 글 쓸 시간 없는 직장인 등
- 해결책으로 자동화를 살짝 암시만 (직접 홍보 X)
- 제품명 언급하지 않기

### blog_tips (블로그 수익화 꿀팁)
- 구체적인 숫자와 팁 제공
- 5년 경험자의 실전 노하우 톤
- 제품 언급 최소화 (가치 제공 중심)
- 마지막에 "프로필 링크 확인" 정도만

### seo_adsense (SEO/애드센스 정보)
- 전문적이지만 쉽게 설명
- 전면광고 배치, CPC 높은 키워드 등 실전 경험 기반
- 구체적인 방법론 제시
- "더 알고 싶으면 프로필 링크" 정도

### product_promo (제품 직접 홍보)
- 핵심 차별점: "AI로 10분 20분 걸리는 거, 이건 1분도 안 걸림"
- 5년 애드센스 경험자가 만든 이유 강조
- 글 퀄리티 + 광고 배치 + SEO 자동 최적화
- CTA: wpauto.kr 방문 유도

### user_reviews (사용자 후기/성과)
- 구체적인 수치 포함 (방문자수, 수익, 글 개수 등)
- 실제 경험담처럼 작성
- "키워드만 넣었는데 1분도 안 돼서 발행 완료" 같은 속도 체감 강조

### wordpress_tips (워드프레스 노하우)
- 초보자 눈높이에 맞춰 설명
- 워드프레스 왜 써야 하는지, 티스토리와 차이
- 제품 언급 하지 않거나 아주 자연스럽게만

## 절대 금지
- 해시태그를 본문에 넣지 않기 (#으로 시작하는 태그 금지)
- 과도한 이모지 (5개 이상 금지)
- "~합니다" 존댓말 (반말 톤 유지)
- 500자 초과`;

  const userPrompt = `카테고리: ${category.label} (${category.type})
토픽: ${topic}

위 카테고리와 토픽에 맞는 Threads 글을 작성해주세요.

JSON 형식으로만 응답:
{
  "text": "Threads 본문 (해시태그 없이, 200~400자)",
  "topicTag": "토픽태그 (# 없이 한단어, 예: 블로그수익화)"
}`;

  console.log("🤖 Claude로 Threads 글 생성 중...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      { role: "user", content: systemPrompt + "\n\n" + userPrompt },
    ],
  });

  const text = response.content[0].text;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      // 본문에서 해시태그 제거 (안전장치)
      result.text = result.text.replace(/#\S+/g, "").trim();
      // 토픽태그에서 # 제거
      result.topicTag = (result.topicTag || category.topicTag).replace(/^#/, "");
      return result;
    }
  } catch (e) {
    console.error("JSON 파싱 실패:", e.message);
  }

  return null;
}

// ============================================
// 4. Threads API로 글 발행
// ============================================
async function postToThreads(text, topicTag) {
  console.log("📤 Threads에 글 발행 중...");

  // Step 1: 미디어 컨테이너 생성
  const createUrl = `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`;
  const createParams = new URLSearchParams({
    media_type: "TEXT",
    text: text,
    access_token: THREADS_ACCESS_TOKEN,
  });

  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createParams,
  });

  const createData = await createResponse.json();

  if (createData.error) {
    throw new Error(
      `컨테이너 생성 실패: ${createData.error.message || JSON.stringify(createData.error)}`
    );
  }

  const containerId = createData.id;
  console.log(`✅ 컨테이너 생성: ${containerId}`);

  // Step 2: 발행 (약간의 지연 후)
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const publishUrl = `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`;
  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: THREADS_ACCESS_TOKEN,
  });

  const publishResponse = await fetch(publishUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: publishParams,
  });

  const publishData = await publishResponse.json();

  if (publishData.error) {
    throw new Error(
      `발행 실패: ${publishData.error.message || JSON.stringify(publishData.error)}`
    );
  }

  console.log(`✅ 발행 완료! Post ID: ${publishData.id}`);
  return publishData;
}

// ============================================
// 5. 워드프레스 글 요약본 Threads 발행
// ============================================
async function postBlogSummaryToThreads(blogTitle, blogUrl, keyword) {
  const client = new Anthropic({ apiKey: CLAUDE_API_KEY });

  const prompt = `블로그 글 제목: "${blogTitle}"
키워드: ${keyword}
블로그 URL: ${blogUrl}

이 블로그 글을 홍보하는 Threads 글을 작성해줘.

규칙:
- 블로그 글의 핵심 내용을 3줄로 요약
- 반말 구어체 ("~거든", "~더라고")
- 200~300자
- 마지막에 "자세한 내용은 프로필 링크에서 확인해봐!" 추가
- 질문형 마무리로 끝내기
- 이모지 2~3개 적절히 사용
- 해시태그 넣지 않기

JSON으로만 응답:
{
  "text": "Threads 본문",
  "topicTag": "토픽태그 (# 없이)"
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      result.text = result.text.replace(/#\S+/g, "").trim();
      result.topicTag = (result.topicTag || "블로그").replace(/^#/, "");
      return result;
    }
  } catch (e) {
    console.error("JSON 파싱 실패:", e.message);
  }
  return null;
}

// ============================================
// Telegram 승인 루프 (일반 콘텐츠 모드)
// ============================================
async function telegramApprovalLoop(telegram, currentPost, category, topic, isDryRun) {
  let approved = false;

  while (!approved) {
    await telegram.sendApprovalMessage(currentPost);

    if (isDryRun) {
      await telegram.sendResult("⏩ [DRY RUN] 실제 발행 건너뜀");
      return null;
    }

    const action = await telegram.waitForApproval();
    await telegram.removeButtons();

    if (action === "approve") {
      approved = true;
    } else if (action === "regenerate") {
      await telegram.sendResult("🔄 글 재생성 중...");
      const newPost = await generateThreadsPost(category, topic);
      if (newPost) {
        currentPost = newPost;
      } else {
        await telegram.sendResult("⚠️ 재생성 실패, 기존 글 유지");
      }
      continue;
    } else if (action === "edit") {
      const editedText = await telegram.waitForTextInput();
      if (editedText) {
        currentPost.text = editedText;
        await telegram.sendResult(`✏️ 수정 완료 (${editedText.length}자)\n새 미리보기를 전송합니다.`);
      } else {
        await telegram.sendResult("⚠️ 수정 입력 시간 초과, 기존 글 유지");
      }
      continue;
    } else if (action === "cancel") {
      await telegram.sendResult("❌ 발행 취소됨");
      return null;
    } else if (action === "timeout") {
      await telegram.sendResult("⏰ 10분 타임아웃 — 자동 취소됨");
      return null;
    }
  }

  return currentPost;
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isBlogMode = args.includes("--blog");
  const isTelegramMode = args.includes("--telegram");

  // Telegram 모드 초기화
  let telegram = null;
  if (isTelegramMode) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("❌ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID가 .env.threads에 설정되어 있지 않습니다.");
      process.exit(1);
    }
    telegram = new TelegramApproval(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
  }

  console.log("=".repeat(50));
  console.log("📱 Threads 자동 포스팅 (@wpauto.kr)");
  if (isTelegramMode) console.log("📲 Telegram 승인 모드");
  console.log("=".repeat(50));

  try {
    // 블로그 글 요약 모드
    if (isBlogMode) {
      const titleIdx = args.indexOf("--title");
      const urlIdx = args.indexOf("--url");
      const keywordIdx = args.indexOf("--keyword");

      if (titleIdx === -1 || urlIdx === -1) {
        console.error("사용법: node threads-post.js --blog --title '제목' --url 'URL' --keyword '키워드'");
        process.exit(1);
      }

      const blogTitle = args[titleIdx + 1];
      const blogUrl = args[urlIdx + 1];
      const keyword = keywordIdx !== -1 ? args[keywordIdx + 1] : "";

      console.log(`\n📝 블로그 글 요약 모드`);
      console.log(`제목: ${blogTitle}`);
      console.log(`URL: ${blogUrl}`);

      const post = await postBlogSummaryToThreads(blogTitle, blogUrl, keyword);
      if (!post) {
        console.error("글 생성 실패");
        if (telegram) await telegram.sendResult("❌ 글 생성 실패");
        process.exit(1);
      }

      if (isTelegramMode) {
        // Telegram 블로그 승인 (재생성 없이 발행/수정/취소만)
        await telegram.sendApprovalMessage(post);

        if (isDryRun) {
          await telegram.sendResult("⏩ [DRY RUN] 실제 발행 건너뜀");
          return;
        }

        const action = await telegram.waitForApproval();
        await telegram.removeButtons();

        if (action === "approve") {
          const result = await postToThreads(post.text, post.topicTag);
          await telegram.sendResult(`✅ Threads 발행 완료!\nPost ID: ${result.id}`);
        } else if (action === "edit") {
          const editedText = await telegram.waitForTextInput();
          if (editedText) {
            // 수정본 미리보기 후 자동 발행
            await telegram.sendApprovalMessage({ text: editedText, topicTag: post.topicTag });
            const confirmAction = await telegram.waitForApproval();
            await telegram.removeButtons();
            if (confirmAction === "approve") {
              const result = await postToThreads(editedText, post.topicTag);
              await telegram.sendResult(`✅ Threads 발행 완료!\nPost ID: ${result.id}`);
            } else {
              await telegram.sendResult("❌ 발행 취소됨");
            }
          } else {
            await telegram.sendResult("⚠️ 수정 입력 시간 초과");
          }
        } else if (action === "timeout") {
          await telegram.sendResult("⏰ 10분 타임아웃 — 자동 취소됨");
        } else {
          await telegram.sendResult("❌ 발행 취소됨");
        }
        return;
      }

      // 기존 stdin 블로그 모드
      console.log(`\n${"─".repeat(40)}`);
      console.log(`📄 생성된 글 미리보기`);
      console.log(`${"─".repeat(40)}`);
      console.log(post.text);
      console.log(`${"─".repeat(40)}`);
      console.log(`토픽태그: #${post.topicTag}`);
      console.log(`글자수: ${post.text.length}자`);

      if (isDryRun) {
        console.log("\n⏩ [DRY RUN] 실제 발행 건너뜀");
        return;
      }

      const answer = await askUser("\n발행하시겠습니까? (y: 발행 / n: 취소 / e: 직접 수정) > ");

      if (answer === "y" || answer === "yes") {
        const result = await postToThreads(post.text, post.topicTag);
        console.log(`\n✅ Threads 발행 완료! ID: ${result.id}`);
      } else if (answer === "e" || answer === "edit") {
        console.log("\n수정할 본문을 입력하세요 (빈 줄 2번 입력시 종료):");
        const editedText = await readMultilineInput();
        if (editedText) {
          console.log(`\n수정된 글 (${editedText.length}자):`);
          console.log(editedText);
          const confirm = await askUser("\n이대로 발행할까요? (y/n) > ");
          if (confirm === "y" || confirm === "yes") {
            const result = await postToThreads(editedText, post.topicTag);
            console.log(`\n✅ Threads 발행 완료! ID: ${result.id}`);
          } else {
            console.log("❌ 발행 취소됨");
          }
        }
      } else {
        console.log("❌ 발행 취소됨");
      }
      return;
    }

    // 일반 콘텐츠 모드
    const contentData = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

    // 카테고리 선택
    const categoryIndex = selectCategory(contentData);
    const category = contentData.categories[categoryIndex];
    console.log(`\n📂 카테고리: ${category.label} (가중치: ${category.weight}%)`);

    // 토픽 선택
    const { topic, resetHistory } = selectTopic(category, contentData.postHistory);
    if (resetHistory) {
      contentData.postHistory = contentData.postHistory.filter(
        (h) => h.categoryType !== category.type
      );
      console.log(`🔄 ${category.label} 카테고리 히스토리 초기화 (모든 토픽 사용됨)`);
    }
    console.log(`📝 토픽: ${topic}`);

    // 글 생성
    const post = await generateThreadsPost(category, topic);
    if (!post) {
      console.error("글 생성 실패");
      if (telegram) await telegram.sendResult("❌ 글 생성 실패");
      process.exit(1);
    }

    let finalPost;

    if (isTelegramMode) {
      // Telegram 승인 루프
      finalPost = await telegramApprovalLoop(telegram, post, category, topic, isDryRun);
      if (!finalPost) return; // 취소/타임아웃/드라이런
    } else {
      // 기존 stdin 승인 루프
      let currentPost = post;
      let approved = false;

      while (!approved) {
        console.log(`\n${"─".repeat(40)}`);
        console.log(`📄 생성된 글 미리보기`);
        console.log(`${"─".repeat(40)}`);
        console.log(currentPost.text);
        console.log(`${"─".repeat(40)}`);
        console.log(`토픽태그: #${currentPost.topicTag}`);
        console.log(`글자수: ${currentPost.text.length}자`);

        if (currentPost.text.length < 100) {
          console.log("⚠️ 경고: 글이 너무 짧습니다 (100자 미만)");
        } else if (currentPost.text.length > 500) {
          console.log("⚠️ 경고: 글이 너무 깁니다 (500자 초과)");
        }

        if (isDryRun) {
          console.log("\n⏩ [DRY RUN] 실제 발행 건너뜀");
          return;
        }

        const answer = await askUser("\n발행하시겠습니까? (y: 발행 / n: 취소 / r: 재생성 / e: 직접 수정) > ");

        if (answer === "y" || answer === "yes") {
          approved = true;
        } else if (answer === "r" || answer === "regenerate") {
          console.log("\n🔄 글 재생성 중...");
          const newPost = await generateThreadsPost(category, topic);
          if (newPost) {
            currentPost = newPost;
          } else {
            console.log("⚠️ 재생성 실패, 기존 글 유지");
          }
          continue;
        } else if (answer === "e" || answer === "edit") {
          console.log("\n수정할 본문을 입력하세요 (빈 줄 2번 입력시 종료):");
          const editedText = await readMultilineInput();
          if (editedText) {
            currentPost.text = editedText;
            console.log(`\n수정 완료 (${editedText.length}자)`);
          }
          continue;
        } else {
          console.log("❌ 발행 취소됨");
          return;
        }
      }
      finalPost = currentPost;
    }

    // 발행
    const result = await postToThreads(finalPost.text, finalPost.topicTag);

    if (isTelegramMode) {
      await telegram.sendResult(`✅ Threads 발행 완료!\nPost ID: ${result.id}`);
    }

    // 발행 이력 저장
    contentData.postHistory.push({
      categoryType: category.type,
      topic: topic,
      topicTag: finalPost.topicTag,
      postId: result.id,
      publishedAt: new Date().toISOString(),
      textLength: finalPost.text.length,
    });
    contentData.lastCategoryIndex = categoryIndex;
    fs.writeFileSync(contentPath, JSON.stringify(contentData, null, 2));

    console.log(`\n${"=".repeat(50)}`);
    console.log(`✅ Threads 발행 완료!`);
    console.log(`📊 발행 이력: ${contentData.postHistory.length}개`);
    console.log(`${"=".repeat(50)}`);
  } finally {
    if (telegram) telegram.stop();
  }
}

main().catch((err) => {
  console.error("오류 발생:", err);
  process.exit(1);
});
