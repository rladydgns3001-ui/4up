const fs = require('fs');
const path = require('path');
const TelegramApproval = require('./threads-telegram');

// .env.threads 로드
const envPath = path.join(__dirname, '.env.threads');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length > 0) env[key.trim()] = vals.join('=').trim();
});

// .env 로드
const wpEnvContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
wpEnvContent.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length > 0) {
    const k = key.trim();
    if (!env[k]) env[k] = vals.join('=').trim();
  }
});

const THREADS_USER_ID = env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = env.THREADS_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID;
const WP_URL = env.WP_URL;
const WP_USER = env.WP_USER;
const WP_APP_PASSWORD = env.WP_APP_PASSWORD;

const VIDEO_PATH = process.argv[2] || '/home/user/saup/docs/0211(3).mp4';
const POST_TEXT = process.argv[3] || `블로그 글 쓰는 시간, 0분으로 만들었습니다

Auto Post V2 Pro
키워드 하나면 끝.

📝 글 작성 → 자동
🖼️ 이미지 생성 → 자동
📡 발행 + 색인 → 자동

키워드 100개 등록하면
100개 글이 예약 시간에 맞춰 나갑니다`;
const TOPIC_TAG = process.argv[4] || '워드프레스자동화';

async function uploadToWordPress(filePath) {
  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');

  console.log(`📤 ${ext === '.mp4' ? '영상' : '이미지'} 업로드 중... (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

  const response = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Type': mimeType,
    },
    body: fileBuffer,
  });

  const data = await response.json();
  if (data.source_url) {
    console.log(`✅ 업로드 완료: ${data.source_url}`);
    return data.source_url;
  }
  console.log(`❌ 업로드 실패:`, data.message || JSON.stringify(data).substring(0, 200));
  return null;
}

async function postToThreads(text, topicTag, mediaUrl, mediaType) {
  console.log(`📤 Threads에 ${mediaType === 'VIDEO' ? '영상' : '텍스트'} 글 발행 중...`);

  const params = {
    media_type: mediaType || 'TEXT',
    text: text,
    access_token: THREADS_ACCESS_TOKEN,
  };
  if (mediaUrl && mediaType === 'IMAGE') params.image_url = mediaUrl;
  if (mediaUrl && mediaType === 'VIDEO') params.video_url = mediaUrl;

  const createResponse = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    }
  );
  const createData = await createResponse.json();
  if (createData.error) {
    throw new Error(`컨테이너 생성 실패: ${createData.error.message}`);
  }
  console.log(`✅ 컨테이너 생성: ${createData.id}`);

  // 영상은 처리 시간이 더 필요
  const waitTime = mediaType === 'VIDEO' ? 30000 : 3000;
  console.log(`⏳ 미디어 처리 대기 중 (${waitTime/1000}초)...`);
  await new Promise(r => setTimeout(r, waitTime));

  const publishResponse = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: createData.id,
        access_token: THREADS_ACCESS_TOKEN,
      }),
    }
  );
  const publishData = await publishResponse.json();
  if (publishData.error) {
    throw new Error(`발행 실패: ${publishData.error.message}`);
  }
  console.log(`✅ Threads 발행 완료! Post ID: ${publishData.id}`);
  return publishData;
}

async function main() {
  console.log("═".repeat(50));
  console.log("🎬 Threads 영상 포스팅 (기존 글 + 새 영상)");
  console.log("═".repeat(50));

  // Telegram 봇 시작
  const telegram = new TelegramApproval(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);

  try {
    const post = {
      text: POST_TEXT,
      threadsText: POST_TEXT,
      topicTag: TOPIC_TAG,
    };

    const mediaInfo = {
      fileName: path.basename(VIDEO_PATH),
      filePath: VIDEO_PATH,
      isVideo: VIDEO_PATH.endsWith('.mp4'),
    };

    console.log(`📝 글: ${post.text.substring(0, 50)}...`);
    console.log(`🎬 영상: ${mediaInfo.fileName}`);

    // 텔레그램 승인 요청 (영상 미리보기 + 6버튼)
    await telegram.sendApprovalMessage(post, mediaInfo);
    console.log("📨 텔레그램 승인 요청 발송 완료");
    console.log("⏳ 승인 대기 중... (최대 2시간)");

    const action = await telegram.waitForApproval();
    await telegram.removeButtons();

    if (action === 'approve') {
      // WordPress에 영상 업로드
      const mediaUrl = await uploadToWordPress(VIDEO_PATH);
      if (!mediaUrl) {
        await telegram.sendResult("❌ 영상 업로드 실패");
        return;
      }

      // Threads 발행
      const result = await postToThreads(post.text, post.topicTag, mediaUrl, 'VIDEO');
      await telegram.sendResult(`✅ Threads 영상 발행 완료!\nPost ID: ${result.id}`);
    } else if (action === 'edit') {
      await telegram.sendResult("✏️ 수정 모드: 텍스트를 보내주세요");
      const editedText = await telegram.waitForTextInput();
      if (editedText) {
        await telegram.sendApprovalMessage({ text: editedText, topicTag: post.topicTag }, mediaInfo);
        const confirmAction = await telegram.waitForApproval();
        await telegram.removeButtons();
        if (confirmAction === 'approve') {
          const mediaUrl = await uploadToWordPress(VIDEO_PATH);
          if (mediaUrl) {
            const result = await postToThreads(editedText, post.topicTag, mediaUrl, 'VIDEO');
            await telegram.sendResult(`✅ Threads 영상 발행 완료!\nPost ID: ${result.id}`);
          }
        } else {
          await telegram.sendResult("❌ 발행 취소됨");
        }
      }
    } else if (action === 'no_media') {
      // 텍스트만 발행
      const result = await postToThreads(post.text, post.topicTag, null, 'TEXT');
      await telegram.sendResult(`✅ Threads 텍스트 발행 완료!\nPost ID: ${result.id}`);
    } else if (action === 'timeout') {
      await telegram.sendResult("⏰ 2시간 타임아웃 — 자동 취소됨");
    } else {
      await telegram.sendResult("❌ 발행 취소됨");
    }
  } finally {
    telegram.stop();
  }

  console.log("\n완료!");
}

main().catch(err => {
  console.error("❌ 오류:", err.message);
  process.exit(1);
});
