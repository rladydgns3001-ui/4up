const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let config;

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

// 글 작성
ipcMain.handle('write-post', async (event, options) => {
  const { keyword, style, length, publish } = options;

  if (!config.isConfigured()) {
    return { success: false, error: '설정을 먼저 완료해주세요.' };
  }

  try {
    const WordPressAPI = require('../src/wordpress');
    const { getSearchContext } = require('../src/search');
    const { generateArticle } = require('../src/writer');

    // 1. WordPress 연결
    const wp = new WordPressAPI();
    const connected = await wp.testConnection();
    if (!connected) {
      return { success: false, error: 'WordPress 연결 실패' };
    }

    // 2. 웹 검색 컨텍스트
    const webContext = await getSearchContext(keyword);

    // 3. 기존 글 분석
    let wpContext = '';
    const existingPosts = await wp.searchPosts(keyword, 3);
    if (existingPosts.length > 0) {
      wpContext = existingPosts.map((p, i) =>
        `[기존글 ${i + 1}] ${p.title}\n${stripHtml(p.excerpt)}`
      ).join('\n\n');
    }

    // 4. AI 글 생성
    const article = await generateArticle(keyword, webContext, wpContext, style, length);
    if (!article.success) {
      return { success: false, error: article.error };
    }

    // 5. WordPress에 저장
    const status = publish ? 'publish' : 'draft';
    const result = await wp.createPost(article.title, article.content, status);

    if (!result.success) {
      return { success: false, error: result.error };
    }

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
