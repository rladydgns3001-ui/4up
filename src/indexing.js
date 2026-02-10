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
 * Naver Search Advisor - URL 제출
 * @param {string} url - 색인 요청할 URL
 * @param {string} apiKey - Naver Search Advisor API Key
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function requestNaverIndexing(url, apiKey) {
  try {
    if (!apiKey) {
      return { success: false, error: 'Naver Search Advisor API Key가 설정되지 않았습니다.' };
    }

    const res = await axios.post(
      'https://searchadvisor.naver.com/api/v1/request/url',
      { url: url },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    );

    return {
      success: true,
      message: `Naver 색인 요청 완료: ${url}`
    };
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    return { success: false, error: `Naver 색인 요청 실패: ${msg}` };
  }
}

/**
 * 설정된 검색엔진에 색인 요청 (Google + Naver)
 * @param {string} url - 색인 요청할 URL
 * @param {object} config - 설정 객체 (GOOGLE_INDEXING_JSON_PATH, NAVER_SEARCH_ADVISOR_KEY)
 * @returns {Promise<{google?: object, naver?: object}>}
 */
async function requestIndexing(url, config) {
  const results = {};

  if (config.GOOGLE_INDEXING_JSON_PATH) {
    results.google = await requestGoogleIndexing(url, config.GOOGLE_INDEXING_JSON_PATH);
  }

  if (config.NAVER_SEARCH_ADVISOR_KEY) {
    results.naver = await requestNaverIndexing(url, config.NAVER_SEARCH_ADVISOR_KEY);
  }

  return results;
}

module.exports = {
  requestGoogleIndexing,
  requestNaverIndexing,
  requestIndexing
};
