const fs = require('fs');
const axios = require('axios');

/**
 * Google Indexing API - URL_UPDATED 알림 전송
 * @param {string} url - 색인 요청할 URL
 * @param {string} jsonKeyPath - 서비스 계정 JSON 파일 경로
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function requestGoogleIndexing(url, jsonKeyPath) {
  try {
    if (!jsonKeyPath || !fs.existsSync(jsonKeyPath)) {
      return { success: false, error: 'Google 서비스 계정 JSON 파일을 찾을 수 없습니다.' };
    }

    const { google } = require('googleapis');

    const keyFile = JSON.parse(fs.readFileSync(jsonKeyPath, 'utf8'));

    const auth = new google.auth.JWT(
      keyFile.client_email,
      null,
      keyFile.private_key,
      ['https://www.googleapis.com/auth/indexing']
    );

    await auth.authorize();

    const res = await axios.post(
      'https://indexing.googleapis.com/v3/urlNotifications:publish',
      {
        url: url,
        type: 'URL_UPDATED'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.credentials.access_token}`
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      message: `Google 색인 요청 완료: ${res.data.urlNotificationMetadata?.url || url}`
    };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    return { success: false, error: `Google 색인 요청 실패: ${msg}` };
  }
}

/**
 * IndexNow - 네이버/Bing 등 지원 검색엔진에 URL 변경 알림
 * @param {string} url - 색인 요청할 URL
 * @param {string} apiKey - IndexNow API Key
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function requestIndexNow(url, apiKey, keyLocation = null) {
  try {
    if (!apiKey) {
      return { success: false, error: 'IndexNow API Key가 설정되지 않았습니다.' };
    }

    const parsedUrl = new URL(url);
    const host = parsedUrl.host;

    const endpoints = [
      'https://api.indexnow.org/indexnow',
      'https://searchadvisor.naver.com/indexnow'
    ];

    const results = [];
    for (const endpoint of endpoints) {
      try {
        const params = {
          url: url,
          key: apiKey
        };
        if (keyLocation) {
          params.keyLocation = keyLocation;
        }
        const res = await axios.get(endpoint, {
          params,
          timeout: 15000,
          validateStatus: (status) => status < 500
        });
        if (res.status === 200 || res.status === 202) {
          results.push(endpoint);
        }
      } catch (e) {
        // 네트워크 오류 등 무시
      }
    }

    return {
      success: results.length > 0,
      message: results.length > 0
        ? `IndexNow 색인 요청 완료 (${results.length}개 엔진): ${url}`
        : `IndexNow 색인 요청 실패: 응답한 엔진 없음 (${url})`
    };
  } catch (error) {
    return { success: false, error: `IndexNow 색인 요청 실패: ${error.message}` };
  }
}

/**
 * Rank Math IndexNow - WordPress Rank Math 플러그인을 통한 색인 요청 (네이버+Bing)
 * @param {string} url - 색인 요청할 URL
 * @param {object} wpConfig - WordPress 설정 {WP_SITE_URL, WP_USERNAME, WP_APP_PASSWORD}
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function requestRankMathIndexNow(url, wpConfig) {
  try {
    const siteUrl = (wpConfig.WP_SITE_URL || '').replace(/\/$/, '');
    if (!siteUrl || !wpConfig.WP_USERNAME || !wpConfig.WP_APP_PASSWORD) {
      return { success: false, error: 'WordPress 연결 정보가 없습니다.' };
    }

    const auth = Buffer.from(`${wpConfig.WP_USERNAME}:${wpConfig.WP_APP_PASSWORD}`).toString('base64');

    const res = await axios.post(
      `${siteUrl}/wp-json/rankmath/v1/in/submitUrls`,
      `urls=${encodeURIComponent(url)}`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    if (res.status === 200 && res.data?.success) {
      return { success: true, message: `Rank Math IndexNow 색인 요청 완료 (네이버+Bing): ${url}` };
    }
    return { success: false, error: `Rank Math IndexNow 실패 (${res.status}): ${JSON.stringify(res.data)}` };
  } catch (error) {
    return { success: false, error: `Rank Math IndexNow 요청 실패: ${error.message}` };
  }
}

/**
 * 설정된 검색엔진에 색인 요청 (Google + IndexNow)
 * @param {string} url - 색인 요청할 URL
 * @param {object} config - 설정 객체 (GOOGLE_INDEXING_JSON_PATH, INDEXNOW_API_KEY, WP_SITE_URL 등)
 * @returns {Promise<{google?: object, indexnow?: object, rankmath?: object}>}
 */
async function requestIndexing(url, config) {
  const results = {};

  if (config.GOOGLE_INDEXING_JSON_PATH) {
    results.google = await requestGoogleIndexing(url, config.GOOGLE_INDEXING_JSON_PATH);
  }

  if (config.INDEXNOW_API_KEY) {
    results.indexnow = await requestIndexNow(url, config.INDEXNOW_API_KEY, config.INDEXNOW_KEY_LOCATION || null);
  }

  if (config.WP_SITE_URL && config.WP_USERNAME && config.WP_APP_PASSWORD) {
    results.rankmath = await requestRankMathIndexNow(url, config);
  }

  return results;
}

module.exports = {
  requestGoogleIndexing,
  requestIndexNow,
  requestRankMathIndexNow,
  requestIndexing
};
