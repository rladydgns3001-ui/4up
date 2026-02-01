// 판매용 버전: JSON 파일로 사용자 설정 관리
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// 설정 파일 경로
function getConfigPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'autopost-config.json');
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
    WP_SITE_URL: '',
    WP_USERNAME: '',
    WP_APP_PASSWORD: '',
    CLAUDE_API_KEY: '',
    ADSENSE_CLIENT_ID: '',
    ADSENSE_SLOT_ID: ''
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
  get WP_SITE_URL() {
    return (getConfigData().WP_SITE_URL || '').replace(/\/$/, '');
  },
  get WP_USERNAME() {
    return getConfigData().WP_USERNAME || '';
  },
  get WP_APP_PASSWORD() {
    return getConfigData().WP_APP_PASSWORD || '';
  },
  get CLAUDE_API_KEY() {
    return getConfigData().CLAUDE_API_KEY || '';
  },
  get ADSENSE_CLIENT_ID() {
    return getConfigData().ADSENSE_CLIENT_ID || '';
  },
  get ADSENSE_SLOT_ID() {
    return getConfigData().ADSENSE_SLOT_ID || '';
  },

  // 애드센스 코드 생성
  getAdsenseCode() {
    const config = getConfigData();
    const clientId = config.ADSENSE_CLIENT_ID || '';
    const slotId = config.ADSENSE_SLOT_ID || '';

    if (!clientId || !slotId) {
      return '<!-- 애드센스 설정 필요 -->';
    }

    return `
<div style="margin: 20px 0; text-align: center;">
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="${clientId}"
       data-ad-slot="${slotId}"
       data-ad-format="auto"
       data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</div>
`;
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

  // 설정 완료 여부 확인
  isConfigured() {
    const config = getConfigData();
    return !!(
      config.WP_SITE_URL &&
      config.WP_USERNAME &&
      config.WP_APP_PASSWORD &&
      config.CLAUDE_API_KEY
    );
  },

  // 캐시 초기화
  reloadConfig() {
    cachedConfig = null;
  }
};
