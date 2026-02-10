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
async function requestIndexNow(url, apiKey) {
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
        await axios.get(endpoint, {
          params: {
            url: url,
            key: apiKey
          },
          timeout: 15000
        });
        results.push(endpoint);
      } catch (e) {
        // 202/200 모두 성공, 4xx/5xx만 실패
        if (e.response && (e.response.status === 200 || e.response.status === 202)) {
          results.push(endpoint);
        }
      }
    }

    return {
      success: true,
      message: `IndexNow 색인 요청 완료 (${results.length}개 엔진): ${url}`
    };
  } catch (error) {
    return { success: false, error: `IndexNow 색인 요청 실패: ${error.message}` };
  }
}

/**
 * 설정된 검색엔진에 색인 요청 (Google + IndexNow)
 * @param {string} url - 색인 요청할 URL
 * @param {object} config - 설정 객체 (GOOGLE_INDEXING_JSON_PATH, INDEXNOW_API_KEY)
 * @returns {Promise<{google?: object, indexnow?: object}>}
 */
async function requestIndexing(url, config) {
  const results = {};

  if (config.GOOGLE_INDEXING_JSON_PATH) {
    results.google = await requestGoogleIndexing(url, config.GOOGLE_INDEXING_JSON_PATH);
  }

  if (config.INDEXNOW_API_KEY) {
    results.indexnow = await requestIndexNow(url, config.INDEXNOW_API_KEY);
  }

  return results;
}

module.exports = {
  requestGoogleIndexing,
  requestIndexNow,
  requestIndexing
};
