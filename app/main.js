const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// ===== 발행 이력 로그 =====
function getLogPath() {
  const path = require('path');
  return path.join(app.getPath('userData'), 'post-log.json');
}

function readLog() {
  try {
    const logPath = getLogPath();
    if (fs.existsSync(logPath)) {
      return JSON.parse(fs.readFileSync(logPath, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function appendLog(entry) {
  try {
    const logs = readLog();
    logs.unshift(entry);
    if (logs.length > 500) logs.splice(500);
    fs.writeFileSync(getLogPath(), JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) {
    console.error('로그 저장 오류:', e);
  }
}

// ===== IPC 핸들러 =====

ipcMain.handle('get-post-log', async () => readLog());

ipcMain.handle('clear-post-log', async () => {
  try {
    fs.writeFileSync(getLogPath(), '[]', 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 사이트별 연결 테스트
ipcMain.handle('test-site-connection', async (event, site) => {
  try {
    const WordPressAPI = require('../src/wordpress');
    const wp = new WordPressAPI(site);
    const connected = await wp.testConnection();
    return { connected };
  } catch (error) {
    return { connected: false, error: error.message };
  }
});

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
// 외부 브라우저로 URL 열기
ipcMain.handle('open-external', async (event, url) => {
  if (url && typeof url === 'string' && url.startsWith('http')) {
    await shell.openExternal(url);
  }
});

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

ipcMain.handle('write-post', async (event, options) => {
  const { keyword, style, length, publish, keywordSettings, selectedSite, extraPrompt } = options;

  if (!config.isConfigured()) {
    return { success: false, error: '설정을 먼저 완료해주세요.' };
  }

  try {
    const WordPressAPI = require('../src/wordpress');
    const { getSearchContext, fetchPageContent } = require('../src/search');
    const { generateArticle } = require('../src/writer');

    const sendProgress = (step, percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('write-progress', { step, percent });
      }
    };

    sendProgress('WordPress 연결 중...', 5);
    const wp = new WordPressAPI(selectedSite || null);
    const connected = await wp.testConnection();
    if (!connected) {
      return { success: false, error: 'WordPress 연결 실패' };
    }

    const kwSettings = keywordSettings ? { ...keywordSettings } : null;
    if (kwSettings?.referenceUrl) {
      sendProgress('참고 URL 가져오는 중...', 10);
      const refPage = await fetchPageContent(kwSettings.referenceUrl);
      kwSettings.referenceUrlContent = refPage.content || '';
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

    // 커스텀 프롬프트 설정
    const customPromptConfig = config.USE_CUSTOM_PROMPT ? {
      useCustom: true,
      systemPrompt: config.CUSTOM_SYSTEM_PROMPT,
      userPrompt: config.CUSTOM_USER_PROMPT
    } : null;

    // 스타일 참고글 주입
    const searchDataWithStyle = { styleReference: config.STYLE_REFERENCE || null };

    // 추가 지시사항 합산 (사이트별 기본 + 1회성)
    const defaultExtra = (selectedSite && selectedSite.defaultExtraPrompt) || '';
    const combinedExtraPrompt = [defaultExtra, extraPrompt || ''].filter(Boolean).join('\n');

    sendProgress('AI 글 생성 중...', 60);
    const article = await generateArticle(keyword, webContext, wpContext, style, length, searchDataWithStyle, kwSettings, customPromptConfig, combinedExtraPrompt);
    if (!article.success) {
      return { success: false, error: article.error };
    }

    sendProgress('이미지 생성 중...', 80);
    const { processImageMarkers } = require('../src/image-generator');
    const imgResult = await processImageMarkers(article.content, article.imageMarkers, wp, keyword);
    let contentWithImages = imgResult.content;
    let featuredImageId = imgResult.featuredImageId;
    const imageErrors = imgResult.errors || [];

    const adsenseClientId = (selectedSite && selectedSite.adsenseClientId) || '';
    const adsenseSlotId = (selectedSite && selectedSite.adsenseSlotId) || '';
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

    sendProgress('WordPress 저장 중...', 95);
    const status = publish ? 'publish' : 'draft';
    const result = await wp.createPost(article.title, contentWithImages, status, null, null, featuredImageId);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    sendProgress('완료!', 100);

    // 로그 저장
    appendLog({
      date: new Date().toISOString(),
      keyword,
      title: article.title,
      status: status === 'publish' ? '발행됨' : '임시저장',
      link: result.link || '',
      postId: result.id,
      siteName: selectedSite?.name || config.WP_SITE_URL
    });

    return {
      success: true,
      title: article.title,
      postId: result.id,
      status: status === 'publish' ? '발행됨' : '임시저장',
      link: result.link,
      editLink: result.editLink,
      imageErrors: imageErrors.length > 0 ? imageErrors : null
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== 예약 발행 큐 =====

// 단일 키워드 처리 (큐에서 호출)
async function processOneKeyword(keyword, style, length, publish, keywordSettings, selectedSite = null, extraPrompt = '') {
  const WordPressAPI = require('../src/wordpress');
  const { getSearchContext, fetchPageContent } = require('../src/search');
  const { generateArticle } = require('../src/writer');

  const sendProgress = (step, percent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('write-progress', { step, percent, keyword });
    }
  };

  sendProgress('WordPress 연결 중...', 5);
  const wp = new WordPressAPI(selectedSite || null);
  const connected = await wp.testConnection();
  if (!connected) {
    throw new Error('WordPress 연결 실패');
  }

  const kwSettings = keywordSettings ? { ...keywordSettings } : null;
  if (kwSettings?.referenceUrl) {
    sendProgress('참고 URL 가져오는 중...', 10);
    const refPage = await fetchPageContent(kwSettings.referenceUrl);
    kwSettings.referenceUrlContent = refPage.content || '';
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

  const customPromptConfig = config.USE_CUSTOM_PROMPT ? {
    useCustom: true,
    systemPrompt: config.CUSTOM_SYSTEM_PROMPT,
    userPrompt: config.CUSTOM_USER_PROMPT
  } : null;

  const searchDataWithStyle = { styleReference: config.STYLE_REFERENCE || null };

  // 추가 지시사항 합산 (사이트별 기본 + 1회성)
  const defaultExtra = (selectedSite && selectedSite.defaultExtraPrompt) || '';
  const combinedExtraPrompt = [defaultExtra, extraPrompt || ''].filter(Boolean).join('\n');

  sendProgress('AI 글 생성 중...', 60);
  const article = await generateArticle(keyword, webContext, wpContext, style, length, searchDataWithStyle, kwSettings, customPromptConfig, combinedExtraPrompt);
  if (!article.success) {
    throw new Error(article.error);
  }

  // 이미지 처리
  sendProgress('이미지 생성 중...', 80);
  const { processImageMarkers } = require('../src/image-generator');
  const imgProcessed = await processImageMarkers(article.content, article.imageMarkers, wp, keyword);
  let contentWithImages = imgProcessed.content;
  let featuredImageId = imgProcessed.featuredImageId;
  const imageErrors = imgProcessed.errors || [];

  // AdSense 광고 삽입 (사이트별)
  const adsenseClientId = (selectedSite && selectedSite.adsenseClientId) || '';
  const adsenseSlotId = (selectedSite && selectedSite.adsenseSlotId) || '';
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
  const result = await wp.createPost(article.title, contentWithImages, postStatus, null, null, featuredImageId);

  if (!result.success) {
    throw new Error(result.error);
  }

  sendProgress('완료!', 100);

  // 로그 저장
  appendLog({
    date: new Date().toISOString(),
    keyword,
    title: article.title,
    status: postStatus === 'publish' ? '발행됨' : '임시저장',
    link: result.link || '',
    postId: result.id,
    siteName: selectedSite?.name || config.WP_SITE_URL
  });

  // 색인 요청 (사이트별 설정)
  let indexingResults = {};
  if (publish && result.link) {
    try {
      const { requestIndexing } = require('../src/indexing');
      const siteIndexConfig = {
        GOOGLE_INDEXING_JSON_PATH: (selectedSite && selectedSite.googleIndexingJsonPath) || '',
        INDEXNOW_API_KEY: (selectedSite && selectedSite.indexNowApiKey) || '',
        WP_SITE_URL: (selectedSite && selectedSite.url) || config.WP_SITE_URL,
        WP_USERNAME: (selectedSite && selectedSite.username) || config.WP_USERNAME,
        WP_APP_PASSWORD: (selectedSite && selectedSite.password) || config.WP_APP_PASSWORD
      };
      indexingResults = await requestIndexing(result.link, siteIndexConfig);
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
    indexing: indexingResults,
    imageErrors: imageErrors.length > 0 ? imageErrors : null
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

  const kwItem = postQueue.keywords[postQueue.currentIndex];
  // 객체 배열(새 방식) 또는 문자열 배열(호환용) 모두 지원
  const keyword = typeof kwItem === 'string' ? kwItem : kwItem.keyword;
  const kwSettings = typeof kwItem === 'object' ? kwItem : null;
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
        postQueue.publish,
        kwSettings,
        postQueue.selectedSite || null,
        postQueue.extraPrompt || ''
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

  const { keywords, scheduleMode, intervalHours, specificTimes, style, length, publish, selectedSite, extraPrompt } = options;

  if (!keywords || keywords.length === 0) {
    return { success: false, error: '키워드를 입력해주세요.' };
  }

  if (keywords.length > 10) {
    return { success: false, error: '최대 10개까지만 등록할 수 있습니다.' };
  }

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
    publish: publish !== false,
    selectedSite: selectedSite || null,
    extraPrompt: extraPrompt || ''
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
