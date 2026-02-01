// 판매용 버전: electron-store에서 사용자 설정 로드
const Store = require('electron-store');

const store = new Store({
  name: 'wp-ai-writer-config',
  defaults: {
    WP_SITE_URL: '',
    WP_USERNAME: '',
    WP_APP_PASSWORD: '',
    CLAUDE_API_KEY: '',
    ADSENSE_CLIENT_ID: '',
    ADSENSE_SLOT_ID: ''
  }
});

module.exports = {
  get WP_SITE_URL() {
    return (store.get('WP_SITE_URL') || '').replace(/\/$/, '');
  },
  get WP_USERNAME() {
    return store.get('WP_USERNAME') || '';
  },
  get WP_APP_PASSWORD() {
    return store.get('WP_APP_PASSWORD') || '';
  },
  get CLAUDE_API_KEY() {
    return store.get('CLAUDE_API_KEY') || '';
  },
  get ADSENSE_CLIENT_ID() {
    return store.get('ADSENSE_CLIENT_ID') || '';
  },
  get ADSENSE_SLOT_ID() {
    return store.get('ADSENSE_SLOT_ID') || '';
  },

  // 애드센스 코드 생성
  getAdsenseCode() {
    const clientId = store.get('ADSENSE_CLIENT_ID') || '';
    const slotId = store.get('ADSENSE_SLOT_ID') || '';

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
  saveConfig(config) {
    if (config.WP_SITE_URL !== undefined) store.set('WP_SITE_URL', config.WP_SITE_URL);
    if (config.WP_USERNAME !== undefined) store.set('WP_USERNAME', config.WP_USERNAME);
    if (config.WP_APP_PASSWORD !== undefined) store.set('WP_APP_PASSWORD', config.WP_APP_PASSWORD);
    if (config.CLAUDE_API_KEY !== undefined) store.set('CLAUDE_API_KEY', config.CLAUDE_API_KEY);
    if (config.ADSENSE_CLIENT_ID !== undefined) store.set('ADSENSE_CLIENT_ID', config.ADSENSE_CLIENT_ID);
    if (config.ADSENSE_SLOT_ID !== undefined) store.set('ADSENSE_SLOT_ID', config.ADSENSE_SLOT_ID);
  },

  // 설정 불러오기
  getConfig() {
    return {
      WP_SITE_URL: store.get('WP_SITE_URL') || '',
      WP_USERNAME: store.get('WP_USERNAME') || '',
      WP_APP_PASSWORD: store.get('WP_APP_PASSWORD') || '',
      CLAUDE_API_KEY: store.get('CLAUDE_API_KEY') || '',
      ADSENSE_CLIENT_ID: store.get('ADSENSE_CLIENT_ID') || '',
      ADSENSE_SLOT_ID: store.get('ADSENSE_SLOT_ID') || ''
    };
  },

  // 설정 완료 여부 확인
  isConfigured() {
    return !!(
      store.get('WP_SITE_URL') &&
      store.get('WP_USERNAME') &&
      store.get('WP_APP_PASSWORD') &&
      store.get('CLAUDE_API_KEY')
    );
  }
};
