// 판매용 버전: JSON 파일로 사용자 설정 관리
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// 설정 파일 경로
function getConfigPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'autopost-config.json');
}

// 기본 사이트 객체
function defaultSite() {
  return { name: '', url: '', username: '', password: '', googleIndexingJsonPath: '', indexNowApiKey: '', adsenseClientId: '', adsenseSlotId: '', defaultExtraPrompt: '' };
}

// 설정 읽기
function readConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('설정 읽기 오류:', error);
  }
  return {
    CLAUDE_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    TEXT_MODEL: 'claude',
    IMAGE_MODEL: 'dalle3',
    CTA_LINK_URL: '',
    CTA_LINK_TEXT: '',
    CTA_MID_TEXT: '',
    WP_SITES: [defaultSite(), defaultSite(), defaultSite()],
    USE_CUSTOM_PROMPT: false,
    CUSTOM_SYSTEM_PROMPT: '',
    CUSTOM_USER_PROMPT: '',
    STYLE_REFERENCE: ''
  };
}

// 설정 쓰기
function writeConfig(config) {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('설정 쓰기 오류:', error);
    return false;
  }
}

// 캐시된 설정
let cachedConfig = null;

function getConfigData() {
  if (!cachedConfig) {
    cachedConfig = readConfig();
  }
  return cachedConfig;
}

module.exports = {
  // 하위 호환: 기존 코드에서 전역 WP_SITE_URL 등을 참조하는 경우 첫 번째 사이트 기준
  get WP_SITE_URL() {
    const sites = getConfigData().WP_SITES || [];
    return ((sites[0] && sites[0].url) || getConfigData().WP_SITE_URL || '').replace(/\/$/, '');
  },
  get WP_USERNAME() {
    const sites = getConfigData().WP_SITES || [];
    return (sites[0] && sites[0].username) || getConfigData().WP_USERNAME || '';
  },
  get WP_APP_PASSWORD() {
    const sites = getConfigData().WP_SITES || [];
    return (sites[0] && sites[0].password) || getConfigData().WP_APP_PASSWORD || '';
  },
  get CLAUDE_API_KEY() {
    return getConfigData().CLAUDE_API_KEY || '';
  },
  get OPENAI_API_KEY() {
    return getConfigData().OPENAI_API_KEY || '';
  },
  get GEMINI_API_KEY() {
    return getConfigData().GEMINI_API_KEY || '';
  },
  get TEXT_MODEL() {
    return getConfigData().TEXT_MODEL || 'claude';
  },
  get IMAGE_MODEL() {
    return getConfigData().IMAGE_MODEL || 'dalle3';
  },
  get CTA_LINK_URL() {
    return getConfigData().CTA_LINK_URL || '';
  },
  get CTA_LINK_TEXT() {
    return getConfigData().CTA_LINK_TEXT || '';
  },
  get CTA_MID_TEXT() {
    return getConfigData().CTA_MID_TEXT || '';
  },
  get WP_SITES() {
    return getConfigData().WP_SITES || [defaultSite(), defaultSite(), defaultSite()];
  },
  get USE_CUSTOM_PROMPT() {
    return getConfigData().USE_CUSTOM_PROMPT || false;
  },
  get CUSTOM_SYSTEM_PROMPT() {
    return getConfigData().CUSTOM_SYSTEM_PROMPT || '';
  },
  get CUSTOM_USER_PROMPT() {
    return getConfigData().CUSTOM_USER_PROMPT || '';
  },
  get STYLE_REFERENCE() {
    return getConfigData().STYLE_REFERENCE || '';
  },

  // 설정 저장
  saveConfig(newConfig) {
    const current = getConfigData();
    const updated = { ...current, ...newConfig };
    if (writeConfig(updated)) {
      cachedConfig = updated;
      return true;
    }
    return false;
  },

  // 설정 불러오기
  getConfig() {
    return getConfigData();
  },

  // 설정 완료 여부 확인 — 첫 번째 사이트 기준
  isConfigured() {
    const config = getConfigData();
    const sites = config.WP_SITES || [];
    const site0 = sites[0] || {};
    const hasWp = !!(site0.url && site0.username && site0.password);
    // 하위 호환: 기존 전역 설정도 체크
    const hasLegacyWp = !!(config.WP_SITE_URL && config.WP_USERNAME && config.WP_APP_PASSWORD);
    return !!((hasWp || hasLegacyWp) && config.CLAUDE_API_KEY);
  },

  // 캐시 초기화
  reloadConfig() {
    cachedConfig = null;
  }
};
