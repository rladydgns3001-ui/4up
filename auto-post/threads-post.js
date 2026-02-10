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

// .env에서 WordPress 인증 정보 로드
const wpEnvPath = path.join(__dirname, ".env");
try {
  const wpEnvContent = fs.readFileSync(wpEnvPath, "utf-8");
  wpEnvContent.split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length > 0 && !envVars[key.trim()]) envVars[key.trim()] = vals.join("=").trim();
  });
} catch {}

const WP_URL = envVars.WP_URL;
const WP_USER = envVars.WP_USER;
const WP_APP_PASSWORD = envVars.WP_APP_PASSWORD;

const contentPath = path.join(__dirname, "threads-content.json");
const refsPath = path.join(__dirname, "threads-viral-refs.json");
const imagesDir = path.join(__dirname, "threads-images");
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
// 1. 사이클 기반 카테고리 선택
// ============================================
function selectCategory(contentData) {
  const { categories, cycle, cyclePosition = 0 } = contentData;

  // 사이클에서 현재 위치의 카테고리 타입 가져오기
  const categoryType = cycle[cyclePosition % cycle.length];
  const selectedIndex = categories.findIndex((c) => c.type === categoryType);

  // 다음 사이클 위치로 이동
  contentData.cyclePosition = (cyclePosition + 1) % cycle.length;

  console.log(`📅 사이클 ${cyclePosition + 1}/${cycle.length}: ${categoryType}`);

  return selectedIndex !== -1 ? selectedIndex : 0;
}

// ============================================
// 2. 토픽 선택 (중복 방지)
// ============================================
function selectTopic(category, postHistory) {
  const usedTopics = postHistory
    .filter((h) => h.categoryType === category.type)
    .map((h) => h.topic);

  // 순서대로 선택: 사용하지 않은 첫 번째 토픽
  const nextTopicIndex = category.topics.findIndex(
    (t) => !usedTopics.includes(t)
  );

  // 모든 토픽을 다 사용했으면 히스토리에서 해당 카테고리 기록 초기화
  if (nextTopicIndex === -1) {
    return {
      topic: category.topics[0],
      resetHistory: true,
    };
  }

  return {
    topic: category.topics[nextTopicIndex],
    resetHistory: false,
  };
}

// ============================================
// 3. WordPress 미디어 업로드 + 이미지 선택
// ============================================
async function uploadToWordPress(filePath) {
  if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
    console.log("⚠️ WordPress 인증 정보 없음, 이미지 스킵");
    return null;
  }

  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const mimeType = fileName.endsWith(".png") ? "image/png" : "image/jpeg";

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
  if (!fs.existsSync(imagesDir)) return null;

  // 카테고리별 미디어 매핑 (이미지 + 영상)
  const categoryMediaMap = {
    empathy: ["adsense-revenue.png"],
    blog_tips: ["adsense-revenue.png"],
    seo_adsense: ["adsense-revenue.png"],
    product_promo: ["program-run-1.mp4", "program-run-2.mp4", "program-run-3.mp4", "homepage.png"],
    user_reviews: ["program-run-1.mp4", "program-run-2.mp4", "program-run-3.mp4"],
    wordpress_tips: ["homepage.png"],
  };

  const candidates = categoryMediaMap[categoryType] || [];
  // 후보 중 랜덤 선택
  const available = candidates.filter((name) => fs.existsSync(path.join(imagesDir, name)));
  if (available.length > 0) {
    const pick = available[Math.floor(Math.random() * available.length)];
    return path.join(imagesDir, pick);
  }

  // fallback: 아무 미디어 선택
  try {
    const files = fs.readdirSync(imagesDir).filter((f) => /\.(png|jpg|jpeg|mp4)$/i.test(f));
    if (files.length > 0) return path.join(imagesDir, files[Math.floor(Math.random() * files.length)]);
  } catch {}
  return null;
}

/**
 * threads-images 디렉토리의 모든 미디어 파일 목록 반환
 * @returns {Array<{fileName: string, filePath: string, isVideo: boolean}>}
 */
function getAvailableMedia() {
  if (!fs.existsSync(imagesDir)) return [];
  try {
    return fs.readdirSync(imagesDir)
      .filter((f) => /\.(png|jpg|jpeg|mp4)$/i.test(f))
      .map((f) => ({
        fileName: f,
        filePath: path.join(imagesDir, f),
        isVideo: f.endsWith(".mp4"),
      }));
  } catch {
    return [];
  }
}

/**
 * 미디어 경로에서 mediaInfo 객체 생성
 */
function buildMediaInfo(mediaPath) {
  if (!mediaPath) return null;
  return {
    fileName: path.basename(mediaPath),
    filePath: mediaPath,
    isVideo: mediaPath.endsWith(".mp4"),
  };
}

// ============================================
// 4. 바이럴 레퍼런스 로드
// ============================================
function loadViralRefs() {
  try {
    const data = JSON.parse(fs.readFileSync(refsPath, "utf-8"));
    return data.references || [];
  } catch {
    return [];
  }
}

function selectRandomRefs(refs, count = 5) {
  if (refs.length <= count) return refs;
  const shuffled = [...refs].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ============================================
// 스포일러 마커 처리 (발행 후 앱에서 수동 적용)
// ============================================
function removeMarkers(text) {
  // {{숨김}}...{{/숨김}} 마커를 제거하고 일반 텍스트로 변환
  return text.replace(/\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g, (_, content) => content);
}

function getSpoilerPreview(text) {
  // Telegram 미리보기용: 스포일러 적용할 구간을 명확히 표시
  return text.replace(
    /\{\{숨김\}\}([\s\S]*?)\{\{\/숨김\}\}/g,
    (_, content) => `⚡【스포일러 적용】${content}【/스포일러】`
  );
}

// ============================================
// 4. Claude API로 Threads 최적화 글 생성
// ============================================
async function generateThreadsPost(category, topic) {
  const client = new Anthropic({ apiKey: CLAUDE_API_KEY });

  const systemPrompt = `당신은 @wpauto.kr (오토포스트) Threads 계정의 콘텐츠 작성자입니다.

## 브랜드 정보
- 제품: 워드프레스 AI 자동 포스팅 프로그램 "오토포스트"
- 핵심 메시지: 요즘 다들 AI로 글 쓴다면서 10~20분 걸리지? 이건 키워드 하나 넣으면 1분도 안 걸려. 발행까지 원클릭.
- 만든 사람: 애드센스 블로그 5년 운영자. 광고 배치, SEO, 글 구조 전부 실전 경험에서 나온 결과물.
- 중요: "글 하나 30분"은 옛날 얘기. 요즘은 AI로 10~20분이 현실. 우리는 1분.
- 차별점: 글 퀄리티가 높음 (프롬프트 수정 필요 없음), 전면광고 배치 자동 최적화, SEO 구조 자동 적용
- 가격: 월정액 없이 한번 구매로 평생 사용
- 문의/구매: https://wpauto.kr (카카오톡 문의, Threads 연락 가능)

## 절대 금지
- 해시태그를 본문에 넣지 않기 (#으로 시작하는 태그 금지)
- 과도한 이모지 (5개 이상 금지)
- 500자 초과

## 톤
- 다체/한다체 사용 (~이다, ~한다, ~된다, ~했다, ~있다)
- 단정적이고 확신있는 톤`;

  // 바이럴 레퍼런스 로드
  const allRefs = loadViralRefs();
  const selectedRefs = selectRandomRefs(allRefs);

  let userPrompt;

  if (selectedRefs.length > 0) {
    // 레퍼런스 기반 프롬프트
    const refsText = selectedRefs
      .map((ref, i) => {
        const metrics = ref.metrics
          ? `(❤️${ref.metrics.likes} 💬${ref.metrics.replies} 🔄${ref.metrics.reposts})`
          : "";
        return `--- 레퍼런스 ${i + 1} ${metrics} ---\n${ref.text}`;
      })
      .join("\n\n");

    userPrompt = `## 바이럴 레퍼런스 (실제 터진 글 ${selectedRefs.length}개):

${refsText}

## 바이럴 글 구조 학습 결과 (반드시 따를 것!)

### 첫줄 훅 (6가지 중 택1, 반드시 강렬하게)
1. 도발형: "요즘 20대가 돈 걱정하는건 지능이 낮은 겁니다" → 댓글 폭발
2. 감탄형: "진짜 미쳤습니다 ㅋㅋㅋ" → 호기심
3. 대비형: "가난한 집 특 :" → 공감
4. 숫자형: "99% 이 6개 문제다" → 신뢰+긴급
5. 질문형: "월화수목금금금 맞나요?" → 참여 유도
6. 권위형: "메타직원 피셜" → 정보 신뢰

나쁜 첫줄 (절대 쓰지 마):
- "할일이 많아?" "블로그 쓰기 힘들지?" "요즘 바쁘지?" → 뻔하고 궁금증 없음

### 글 구조 패턴 (3가지 중 택1)
**패턴A - 도발→리스트→반전** (댓글 폭발용):
  도발적 첫줄 → 번호 리스트 → "~일거 같지?" 반전 질문 → 현실 폭로
  예: "20대가 돈 걱정하면 지능이 낮다" → 지원금 리스트 → "실제론 못 받음"

**패턴B - 훅→숨김 답변** (터치 유도용):
  강렬한 훅 → 핵심 답변을 숨김 처리 → 클리프행어 마무리
  예: "99% 이 6개 문제다" → 1~6번 숨김 → "이것도 안되면..."

**패턴C - 극도 단문** (댓글 비율 극대화):
  3줄 이하. 질문만으로 구성. 40~80자.
  예: "1인 사업하면\\n\\n월화수목금금금 맞나요?\\n\\n언제까지 그래야할까요?"

### 줄바꿈 규칙
- 문장마다 빈줄 (극단적 줄바꿈이 Threads에서 효과적)
- 서론(1~2줄) + 빈줄 + 본문 + 빈줄 + 마무리
- 한 줄에 한 문장만

### 스포일러 효과 ({{숨김}}텍스트{{/숨김}})
발행 후 앱에서 수동으로 스포일러 처리할 부분을 표시해줘.
**원칙: 문제가 아니라 답변/해결책/반전을 숨겨야 터치함**

배치 유형:
- 리스트 답변 전체 숨김: 서론 훅 → {{숨김}}1. xxx\\n2. xxx\\n3. xxx{{/숨김}}
- 핵심 단어만 숨김: "가장 잘하는 곳은 {{숨김}}xxxx{{/숨김}}입니다"
- 마지막만 숨김: 1~4번 보여주고 → 5. {{숨김}}핵심 반전{{/숨김}}
- 여러 곳 숨김: 리스트 일부 + 결론 동시 숨김

숨김 X (절대 하지 마): 서론, 문제 설명, 감정 표현

## 글 작성 지시
카테고리: ${category.label} (${category.type})
토픽: ${topic}

위 학습 결과를 바탕으로, 레퍼런스의 구조를 복제하되 우리 브랜드 키워드로 새 글을 써.
글자수: 100~400자 (짧을수록 좋음. 패턴C는 40~80자도 OK)
톤: 다체/한다체 (~이다, ~한다, ~된다, ~했다). 단정적이고 확신있게.
이모지: 0~3개 (없어도 됨)

JSON 형식으로만 응답:
{
  "text": "Threads 본문 (숨길 부분은 {{숨김}}텍스트{{/숨김}}로 감싸기)",
  "topicTag": "토픽태그 (# 없이 한단어, 예: 블로그수익화)"
}`;
  } else {
    // 레퍼런스 없을 때 기존 방식 (fallback)
    userPrompt = `카테고리: ${category.label} (${category.type})
토픽: ${topic}

위 카테고리와 토픽에 맞는 Threads 글을 작성해주세요.

규칙:
1. 첫 줄 = 검색 키워드 역할 (구글이 Threads를 인덱싱함)
2. 구어체 사용 ("~거든", "~더라고", "~해봤는데", "~잖아")
3. 반말 톤 사용 (친근한 느낌)
4. 질문형 마무리 필수 (댓글 유도 = 알고리즘 핵심 신호)
5. 글자수 200~400자
6. 이모지 적절히 사용 (2~4개)
7. 줄바꿈으로 가독성 확보 (2~3줄마다 줄바꿈)
8. 해시태그 없음

JSON 형식으로만 응답:
{
  "text": "Threads 본문 (해시태그 없이, 200~400자)",
  "topicTag": "토픽태그 (# 없이 한단어, 예: 블로그수익화)"
}`;
  }

  console.log(selectedRefs.length > 0
    ? `🤖 Claude로 Threads 글 생성 중... (레퍼런스 ${selectedRefs.length}개 참고)`
    : "🤖 Claude로 Threads 글 생성 중...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [
      { role: "user", content: systemPrompt + "\n\n" + userPrompt },
    ],
  });

  const rawText = response.content[0].text;
  console.log("📝 Claude 응답 수신 완료");

  try {
    // ```json ... ``` 래퍼 제거
    const cleaned = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      // 본문에서 해시태그 제거 (안전장치)
      result.text = result.text.replace(/#\S+/g, "").trim();
      // 토픽태그에서 # 제거
      result.topicTag = (result.topicTag || category.topicTag).replace(/^#/, "");
      // 숨김 마커가 있으면 Telegram 미리보기용 + Threads용 분리
      if (result.text.includes("{{숨김}}")) {
        result.previewText = getSpoilerPreview(result.text);
        result.threadsText = removeMarkers(result.text);
        console.log("⚡ 스포일러 구간 표시됨 (발행 후 앱에서 수동 적용)");
      } else {
        result.previewText = result.text;
        result.threadsText = result.text;
      }
      return result;
    }
  } catch (e) {
    console.error("JSON 파싱 실패:", e.message);
    console.error("원본 응답:", rawText.substring(0, 200));
  }

  return null;
}

// ============================================
// 5. Threads API로 글 발행
// ============================================
async function postToThreads(text, topicTag, mediaUrl = null, mediaType = null) {
  console.log("📤 Threads에 글 발행 중...");

  // Step 1: 미디어 컨테이너 생성
  const createUrl = `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`;
  const type = mediaType || (mediaUrl ? "IMAGE" : "TEXT");
  const params = {
    media_type: type,
    text: text,
    access_token: THREADS_ACCESS_TOKEN,
  };
  if (mediaUrl && type === "IMAGE") params.image_url = mediaUrl;
  if (mediaUrl && type === "VIDEO") params.video_url = mediaUrl;
  const createParams = new URLSearchParams(params);

  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: createParams,
  });

  const createData = await createResponse.json();

  if (createData.error) {
    console.error("❌ Threads API 에러 상세:", JSON.stringify(createData, null, 2));
    console.error("❌ 요청 URL:", createUrl);
    console.error("❌ USER_ID:", THREADS_USER_ID);
    console.error("❌ TOKEN 앞 10자:", THREADS_ACCESS_TOKEN?.substring(0, 10) + "...");
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
// 6. 워드프레스 글 요약본 Threads 발행
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
async function telegramApprovalLoop(telegram, currentPost, category, topic, isDryRun, mediaInfo) {
  let approved = false;
  let currentMedia = mediaInfo; // { fileName, filePath, isVideo } or null

  while (!approved) {
    await telegram.sendApprovalMessage(currentPost, currentMedia);

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
    } else if (action === "change_media") {
      const allMedia = getAvailableMedia();
      if (allMedia.length === 0) {
        await telegram.sendResult("⚠️ 사용 가능한 미디어가 없습니다.");
        continue;
      }
      await telegram.sendMediaOptions(allMedia);
      const chosenIndex = await telegram.waitForMediaChoice();
      await telegram.removeButtons();
      if (chosenIndex !== null && chosenIndex >= 0 && chosenIndex < allMedia.length) {
        currentMedia = allMedia[chosenIndex];
        const typeLabel = currentMedia.isVideo ? "영상" : "이미지";
        await telegram.sendResult(`📷 미디어 변경: ${currentMedia.fileName} (${typeLabel})`);
      } else {
        await telegram.sendResult("⚠️ 미디어 선택 시간 초과, 기존 미디어 유지");
      }
      continue;
    } else if (action === "no_media") {
      currentMedia = null;
      await telegram.sendResult("🚫 미디어 없이 텍스트만 발행합니다.");
      continue;
    } else if (action === "cancel") {
      await telegram.sendResult("❌ 발행 취소됨");
      return null;
    } else if (action === "timeout") {
      await telegram.sendResult("⏰ 2시간 타임아웃 — 자동 취소됨");
      return null;
    }
  }

  return { post: currentPost, media: currentMedia };
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
          await telegram.sendResult("⏰ 2시간 타임아웃 — 자동 취소됨");
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
    console.log(`\n📂 카테고리: ${category.label}`);

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
    let finalMedia = null; // { fileName, filePath, isVideo } or null

    if (isTelegramMode) {
      // 승인 전에 미디어 선택 (미리보기에 표시하기 위해)
      const mediaPath = selectMedia(category.type);
      const mediaInfo = buildMediaInfo(mediaPath);
      if (mediaInfo) {
        console.log(`📸 미디어 자동 선택: ${mediaInfo.fileName} (${mediaInfo.isVideo ? "영상" : "이미지"})`);
      }

      // Telegram 승인 루프 (미디어 정보 포함)
      const result = await telegramApprovalLoop(telegram, post, category, topic, isDryRun, mediaInfo);
      if (!result) return; // 취소/타임아웃/드라이런
      finalPost = result.post;
      finalMedia = result.media;
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
    // 미디어 선택 + WordPress 업로드
    let mediaUrl = null;
    let mediaType = null;

    if (isTelegramMode) {
      // Telegram 모드: 승인 루프에서 결정된 미디어 사용
      if (finalMedia) {
        console.log(`📸 미디어 발행: ${finalMedia.fileName} (${finalMedia.isVideo ? "영상" : "이미지"})`);
        mediaUrl = await uploadToWordPress(finalMedia.filePath);
        if (mediaUrl) mediaType = finalMedia.isVideo ? "VIDEO" : "IMAGE";
      } else {
        console.log("📝 미디어 없이 텍스트만 발행");
      }
    } else {
      // stdin 모드: 기존 방식 (자동 선택)
      const mediaPath = selectMedia(category.type);
      if (mediaPath) {
        const isVideo = mediaPath.endsWith(".mp4");
        console.log(`📸 미디어 선택: ${path.basename(mediaPath)} (${isVideo ? "영상" : "이미지"})`);
        mediaUrl = await uploadToWordPress(mediaPath);
        if (mediaUrl) mediaType = isVideo ? "VIDEO" : "IMAGE";
      }
    }

    const result = await postToThreads(finalPost.threadsText || finalPost.text, finalPost.topicTag, mediaUrl, mediaType);

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
