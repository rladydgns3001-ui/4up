const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let config;

// 예약 발행 큐 상태
let postQueue = {
  active: false,
  keywords: [],
  currentIndex: 0,
  results: [],
  timer: null,
  scheduleMode: 'immediate', // 'immediate' | 'interval' | 'specific'
  intervalHours: 2,
  specificTimes: [],
  style: 'informative',
  length: 'medium',
  publish: true
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  // app이 ready된 후에 config 로드
  config = require('../src/config');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// HTML 태그 제거 (cheerio 없이)
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== IPC 핸들러 =====

// 설정 저장
ipcMain.handle('save-config', async (event, newConfig) => {
  try {
    config.saveConfig(newConfig);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 설정 불러오기
ipcMain.handle('get-config', async () => {
  return config.getConfig();
});

// 설정 완료 여부 확인
ipcMain.handle('is-configured', async () => {
  return config.isConfigured();
});

// WordPress 연결 테스트
ipcMain.handle('test-connection', async () => {
  if (!config.isConfigured()) {
    return { connected: false, error: '설정을 먼저 완료해주세요.' };
  }

  try {
    const WordPressAPI = require('../src/wordpress');
    const wp = new WordPressAPI();
    const connected = await wp.testConnection();
    return { connected };
  } catch (error) {
    return { connected: false, error: error.message };
  }
});

// Google 서비스 계정 JSON 파일 선택 다이얼로그
ipcMain.handle('select-json-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Google 서비스 계정 JSON 파일 선택',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false };
  }
  return { success: true, path: result.filePaths[0] };
});

// 글 작성 (단일 키워드 - 기존 핸들러 그대로 유지)
ipcMain.handle('write-post', async (event, options) => {
  const { keyword, style, length, publish } = options;

  if (!config.isConfigured()) {
    return { success: false, error: '설정을 먼저 완료해주세요.' };
  }

  try {
    const WordPressAPI = require('../src/wordpress');
    const { getSearchContext } = require('../src/search');
    const { generateArticle } = require('../src/writer');

    // 진행률 전송 헬퍼
    const sendProgress = (step, percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-progress', { step, percent });
      }
    };

    // 1. WordPress 연결
    sendProgress('WordPress 연결 중...', 5);
    const wp = new WordPressAPI();
    const connected = await wp.testConnection();
    if (!connected) {
      return { success: false, error: 'WordPress 연결 실패' };
    }

    // 2. 웹 검색 컨텍스트
    sendProgress('웹 검색 중...', 20);
    const webContext = await getSearchContext(keyword);

    // 3. 기존 글 분석
    sendProgress('기존 글 분석 중...', 25);
    let wpContext = '';
    const existingPosts = await wp.searchPosts(keyword, 3);
    if (existingPosts.length > 0) {
      wpContext = existingPosts.map((p, i) =>
        `[기존글 ${i + 1}] ${p.title}\n${stripHtml(p.excerpt)}`
      ).join('\n\n');
    }

    // 4. AI 글 생성
    sendProgress('AI 글 생성 중...', 60);
    const article = await generateArticle(keyword, webContext, wpContext, style, length);
    if (!article.success) {
      return { success: false, error: article.error };
    }

    // 4.5. 이미지 처리: DALL-E 3로 이미지 생성 후 WordPress에 업로드
    sendProgress('이미지 생성 중...', 80);
    let contentWithImages = article.content;
    if (article.imageMarkers && article.imageMarkers.length > 0 && config.OPENAI_API_KEY) {
      for (let i = 0; i < article.imageMarkers.length; i++) {
        const description = article.imageMarkers[i];
        try {
          const axios = require('axios');
          // DALL-E 3으로 이미지 생성
          const dalleResponse = await axios.post('https://api.openai.com/v1/images/generations', {
            model: 'dall-e-3',
            prompt: `Blog illustration: ${description}. Professional, clean, informative style. ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO WRITING, NO CHARACTERS in the image. Pure visual illustration only.`,
            n: 1,
            size: '1024x1024',
            quality: 'standard'
          }, {
            headers: {
              'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 60000
          });

          const imageUrl = dalleResponse.data.data[0].url;

          // WordPress에 이미지 업로드
          const imgResult = await wp.uploadImage(imageUrl, `${keyword.replace(/\s+/g, '-')}-${i + 1}`);
          if (imgResult.success) {
            const imgHtml = `<figure style="margin:30px 0;text-align:center;"><img src="${imgResult.url}" alt="${keyword} 관련 이미지" style="max-width:100%;height:auto;border-radius:10px;" /><figcaption style="color:#888;font-size:0.85rem;margin-top:8px;">${keyword}</figcaption></figure>`;
            contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, imgHtml);
          } else {
            contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
          }
        } catch (imgError) {
          console.error('이미지 생성 오류:', imgError.message);
          contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
        }
      }
    } else if (article.imageMarkers && article.imageMarkers.length > 0) {
      // OpenAI API Key 없으면 이미지 마커 제거
      for (let i = 0; i < article.imageMarkers.length; i++) {
        contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
      }
    }

    // 4.8. AdSense 광고 삽입 (목차 아래, 본문 중간, FAQ 직전)
    const adsenseClientId = config.ADSENSE_CLIENT_ID;
    const adsenseSlotId = config.ADSENSE_SLOT_ID;
    if (adsenseClientId && adsenseSlotId) {
      const adCode = `<div style="margin:30px 0;text-align:center;"><ins class="adsbygoogle" style="display:block" data-ad-client="${adsenseClientId}" data-ad-slot="${adsenseSlotId}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;

      // 1) 목차(toc-container) 닫는 태그 바로 뒤
      const tocEndMatch = contentWithImages.match(/<\/div>\s*(?=<h2)/i);
      const tocContainerEnd = contentWithImages.indexOf('toc-container');
      if (tocContainerEnd !== -1) {
        // toc-container 이후 첫 번째 </div> 찾기
        const afterToc = contentWithImages.indexOf('</div>', tocContainerEnd);
        if (afterToc !== -1) {
          const insertPos = afterToc + 6;
          contentWithImages = contentWithImages.slice(0, insertPos) + adCode + contentWithImages.slice(insertPos);
        }
      }

      // 2) FAQ 섹션 직전 (FAQ, 자주 묻는 질문 포함된 h2 앞)
      const faqMatch = contentWithImages.match(/<h2[^>]*>[\s\S]*?(?:FAQ|자주\s*묻는\s*질문)[\s\S]*?<\/h2>/i);
      if (faqMatch) {
        const faqPos = contentWithImages.indexOf(faqMatch[0]);
        if (faqPos !== -1) {
          contentWithImages = contentWithImages.slice(0, faqPos) + adCode + contentWithImages.slice(faqPos);
        }
      }

      // 3) 본문 중간 (전체 h2 중 가운데 h2 앞)
      const h2Positions = [];
      const h2Regex = /<h2[\s>]/gi;
      let match;
      while ((match = h2Regex.exec(contentWithImages)) !== null) {
        h2Positions.push(match.index);
      }
      if (h2Positions.length >= 4) {
        const midIndex = Math.floor(h2Positions.length / 2);
        const midPos = h2Positions[midIndex];
        contentWithImages = contentWithImages.slice(0, midPos) + adCode + contentWithImages.slice(midPos);
      }
    }

    // 5. WordPress에 저장
    sendProgress('WordPress 저장 중...', 95);
    const status = publish ? 'publish' : 'draft';
    const result = await wp.createPost(article.title, contentWithImages, status);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    sendProgress('완료!', 100);

    return {
      success: true,
      title: article.title,
      postId: result.id,
      status: status === 'publish' ? '발행됨' : '임시저장',
      link: result.link,
      editLink: result.editLink
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== 예약 발행 큐 =====

// 단일 키워드 처리 (큐에서 호출)
async function processOneKeyword(keyword, style, length, publish) {
  const WordPressAPI = require('../src/wordpress');
  const { getSearchContext } = require('../src/search');
  const { generateArticle } = require('../src/writer');

  // 큐 모드 진행률 전송 헬퍼
  const sendProgress = (step, percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('write-progress', { step, percent, keyword });
    }
  };

  sendProgress('WordPress 연결 중...', 5);
  const wp = new WordPressAPI();
  const connected = await wp.testConnection();
  if (!connected) {
    throw new Error('WordPress 연결 실패');
  }

  sendProgress('웹 검색 중...', 20);
  const webContext = await getSearchContext(keyword);

  sendProgress('기존 글 분석 중...', 25);
  let wpContext = '';
  const existingPosts = await wp.searchPosts(keyword, 3);
  if (existingPosts.length > 0) {
    wpContext = existingPosts.map((p, i) =>
      `[기존글 ${i + 1}] ${p.title}\n${stripHtml(p.excerpt)}`
    ).join('\n\n');
  }

  sendProgress('AI 글 생성 중...', 60);
  const article = await generateArticle(keyword, webContext, wpContext, style, length);
  if (!article.success) {
    throw new Error(article.error);
  }

  // 이미지 처리
  sendProgress('이미지 생성 중...', 80);
  let contentWithImages = article.content;
  if (article.imageMarkers && article.imageMarkers.length > 0 && config.OPENAI_API_KEY) {
    for (let i = 0; i < article.imageMarkers.length; i++) {
      const description = article.imageMarkers[i];
      try {
        const axios = require('axios');
        const dalleResponse = await axios.post('https://api.openai.com/v1/images/generations', {
          model: 'dall-e-3',
          prompt: `Blog illustration: ${description}. Professional, clean, informative style. ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO WRITING, NO CHARACTERS in the image. Pure visual illustration only.`,
          n: 1,
          size: '1024x1024',
          quality: 'standard'
        }, {
          headers: {
            'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        const imageUrl = dalleResponse.data.data[0].url;
        const imgResult = await wp.uploadImage(imageUrl, `${keyword.replace(/\s+/g, '-')}-${i + 1}`);
        if (imgResult.success) {
          const imgHtml = `<figure style="margin:30px 0;text-align:center;"><img src="${imgResult.url}" alt="${keyword} 관련 이미지" style="max-width:100%;height:auto;border-radius:10px;" /><figcaption style="color:#888;font-size:0.85rem;margin-top:8px;">${keyword}</figcaption></figure>`;
          contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, imgHtml);
        } else {
          contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
        }
      } catch (imgError) {
        console.error('이미지 생성 오류:', imgError.message);
        contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
      }
    }
  } else if (article.imageMarkers && article.imageMarkers.length > 0) {
    for (let i = 0; i < article.imageMarkers.length; i++) {
      contentWithImages = contentWithImages.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
    }
  }

  // AdSense 광고 삽입
  const adsenseClientId = config.ADSENSE_CLIENT_ID;
  const adsenseSlotId = config.ADSENSE_SLOT_ID;
  if (adsenseClientId && adsenseSlotId) {
    const adCode = `<div style="margin:30px 0;text-align:center;"><ins class="adsbygoogle" style="display:block" data-ad-client="${adsenseClientId}" data-ad-slot="${adsenseSlotId}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;

    const tocContainerEnd = contentWithImages.indexOf('toc-container');
    if (tocContainerEnd !== -1) {
      const afterToc = contentWithImages.indexOf('</div>', tocContainerEnd);
      if (afterToc !== -1) {
        const insertPos = afterToc + 6;
        contentWithImages = contentWithImages.slice(0, insertPos) + adCode + contentWithImages.slice(insertPos);
      }
    }

    const faqMatch = contentWithImages.match(/<h2[^>]*>[\s\S]*?(?:FAQ|자주\s*묻는\s*질문)[\s\S]*?<\/h2>/i);
    if (faqMatch) {
      const faqPos = contentWithImages.indexOf(faqMatch[0]);
      if (faqPos !== -1) {
        contentWithImages = contentWithImages.slice(0, faqPos) + adCode + contentWithImages.slice(faqPos);
      }
    }

    const h2Positions = [];
    const h2Regex = /<h2[\s>]/gi;
    let match;
    while ((match = h2Regex.exec(contentWithImages)) !== null) {
      h2Positions.push(match.index);
    }
    if (h2Positions.length >= 4) {
      const midIndex = Math.floor(h2Positions.length / 2);
      const midPos = h2Positions[midIndex];
      contentWithImages = contentWithImages.slice(0, midPos) + adCode + contentWithImages.slice(midPos);
    }
  }

  // WordPress에 저장
  sendProgress('WordPress 저장 중...', 95);
  const postStatus = publish ? 'publish' : 'draft';
  const result = await wp.createPost(article.title, contentWithImages, postStatus);

  if (!result.success) {
    throw new Error(result.error);
  }

  sendProgress('완료!', 100);

  // 색인 요청
  let indexingResults = {};
  if (publish && result.link) {
    try {
      const { requestIndexing } = require('../src/indexing');
      indexingResults = await requestIndexing(result.link, config);
    } catch (indexError) {
      console.error('색인 요청 오류:', indexError.message);
    }
  }

  return {
    success: true,
    keyword,
    title: article.title,
    postId: result.id,
    status: postStatus === 'publish' ? '발행됨' : '임시저장',
    link: result.link,
    editLink: result.editLink,
    indexing: indexingResults
  };
}

// 다음 키워드 예약 처리
function scheduleNextKeyword() {
  if (!postQueue.active || postQueue.currentIndex >= postQueue.keywords.length) {
    // 큐 완료
    postQueue.active = false;
    postQueue.timer = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('queue-progress', {
        type: 'completed',
        total: postQueue.keywords.length,
        results: postQueue.results
      });
    }
    return;
  }

  const keyword = postQueue.keywords[postQueue.currentIndex];
  let delayMs = 0;

  if (postQueue.currentIndex === 0) {
    // 첫 번째 키워드는 즉시 처리
    delayMs = 0;
  } else if (postQueue.scheduleMode === 'interval') {
    delayMs = postQueue.intervalHours * 60 * 60 * 1000;
  } else if (postQueue.scheduleMode === 'specific') {
    const targetTime = postQueue.specificTimes[postQueue.currentIndex];
    if (targetTime) {
      const now = new Date();
      const [hours, minutes] = targetTime.split(':').map(Number);
      const target = new Date(now);
      target.setHours(hours, minutes, 0, 0);
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }
      delayMs = target.getTime() - now.getTime();
    }
  }

  // 다음 발행 예정 시간 계산
  const nextTime = new Date(Date.now() + delayMs);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue-progress', {
      type: 'waiting',
      currentIndex: postQueue.currentIndex,
      total: postQueue.keywords.length,
      currentKeyword: keyword,
      nextTime: nextTime.toISOString(),
      results: postQueue.results
    });
  }

  postQueue.timer = setTimeout(async () => {
    if (!postQueue.active) return;

    // 처리 시작 알림
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('queue-progress', {
        type: 'processing',
        currentIndex: postQueue.currentIndex,
        total: postQueue.keywords.length,
        currentKeyword: keyword,
        results: postQueue.results
      });
    }

    try {
      const result = await processOneKeyword(
        keyword,
        postQueue.style,
        postQueue.length,
        postQueue.publish
      );
      postQueue.results.push(result);
    } catch (error) {
      postQueue.results.push({
        success: false,
        keyword,
        error: error.message
      });
    }

    postQueue.currentIndex++;
    scheduleNextKeyword();
  }, delayMs);
}

// 예약 발행 시작
ipcMain.handle('start-scheduled-posts', async (event, options) => {
  if (postQueue.active) {
    return { success: false, error: '이미 큐가 실행 중입니다.' };
  }

  if (!config.isConfigured()) {
    return { success: false, error: '설정을 먼저 완료해주세요.' };
  }

  const { keywords, scheduleMode, intervalHours, specificTimes, style, length, publish } = options;

  if (!keywords || keywords.length === 0) {
    return { success: false, error: '키워드를 입력해주세요.' };
  }

  if (keywords.length > 10) {
    return { success: false, error: '최대 10개까지만 등록할 수 있습니다.' };
  }

  // 큐 초기화
  postQueue = {
    active: true,
    keywords,
    currentIndex: 0,
    results: [],
    timer: null,
    scheduleMode: scheduleMode || 'immediate',
    intervalHours: intervalHours || 2,
    specificTimes: specificTimes || [],
    style: style || 'informative',
    length: length || 'medium',
    publish: publish !== false
  };

  // 큐 처리 시작
  scheduleNextKeyword();

  return { success: true, total: keywords.length };
});

// 예약 발행 취소
ipcMain.handle('cancel-scheduled-posts', async () => {
  if (postQueue.timer) {
    clearTimeout(postQueue.timer);
  }
  postQueue.active = false;
  postQueue.timer = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('queue-progress', {
      type: 'cancelled',
      processedCount: postQueue.currentIndex,
      total: postQueue.keywords.length,
      results: postQueue.results
    });
  }

  return { success: true, processedCount: postQueue.currentIndex };
});

// 큐 상태 조회
ipcMain.handle('get-queue-status', async () => {
  return {
    active: postQueue.active,
    currentIndex: postQueue.currentIndex,
    total: postQueue.keywords.length,
    results: postQueue.results,
    scheduleMode: postQueue.scheduleMode
  };
});
