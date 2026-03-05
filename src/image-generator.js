const axios = require('axios');
const config = require('./config');

/**
 * DALL-E 3 이미지 생성 + WordPress 업로드 모듈
 * Python image_generator.py 핵심 로직의 Node.js 포팅
 */

const DALLE_API_URL = 'https://api.openai.com/v1/images/generations';

/**
 * DALL-E 3용 프롬프트 생성 (텍스트 없는 일러스트)
 */
function buildDallePrompt(description) {
  return `Minimalist flat design illustration: ${description}. Abstract geometric shapes, simple icons, soft pastel gradient background. NO shops, NO storefronts, NO signs, NO streets, NO screens, NO documents, NO books, NO menus. The entire image must be completely free of any text, letters, numbers, characters, symbols, labels, or writing in any language. Clean vector art style with solid color fills.`;
}

/**
 * DALL-E 3로 단일 이미지 생성
 * @param {string} description - 이미지 설명 (영어)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function generateSingleImage(description) {
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY가 설정되지 않았습니다.' };
  }

  try {
    const response = await axios.post(DALLE_API_URL, {
      model: 'dall-e-3',
      prompt: buildDallePrompt(description),
      n: 1,
      size: '1024x1024',
      quality: 'standard'
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return {
      success: true,
      url: response.data.data[0].url
    };
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error('DALL-E 이미지 생성 오류:', msg);
    return { success: false, error: msg };
  }
}

/**
 * 이미지 마커들을 처리: DALL-E 생성 → WP 업로드 → HTML 삽입
 * @param {string} content - IMAGE_PLACEHOLDER가 포함된 본문 HTML
 * @param {string[]} imageMarkers - 이미지 설명 배열
 * @param {object} wp - WordPressAPI 인스턴스
 * @param {string} keyword - 키워드 (파일명/alt용)
 * @returns {Promise<{content: string, featuredImageId: number|null}>}
 */
async function processImageMarkers(content, imageMarkers, wp, keyword) {
  let result = content;
  let featuredImageId = null;
  const errors = [];

  if (!imageMarkers || imageMarkers.length === 0) {
    return { content: result, featuredImageId, errors: ['[IMAGE:] 마커가 AI 응답에 없었습니다.'] };
  }

  if (!config.OPENAI_API_KEY) {
    for (let i = 0; i < imageMarkers.length; i++) {
      result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
    }
    return { content: result, featuredImageId, errors: ['OpenAI API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.'] };
  }

  for (let i = 0; i < imageMarkers.length; i++) {
    const description = imageMarkers[i];
    try {
      const imgGen = await generateSingleImage(description);
      if (!imgGen.success) {
        errors.push(`이미지 생성 실패: ${imgGen.error}`);
        result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
        continue;
      }

      const filename = `${keyword.replace(/\s+/g, '-')}-${i + 1}`;
      const imgResult = await wp.uploadImage(imgGen.url, filename);

      if (imgResult.success) {
        if (i === 0) featuredImageId = imgResult.id;
        const imgHtml = `<figure style="margin:30px 0;text-align:center;"><img src="${imgResult.url}" alt="${keyword} 관련 이미지" style="max-width:100%;height:auto;border-radius:10px;" /><figcaption style="color:#888;font-size:0.85rem;margin-top:8px;">${keyword}</figcaption></figure>`;
        result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, imgHtml);
      } else {
        errors.push(`WP 업로드 실패: ${imgResult.error}`);
        result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
      }
    } catch (error) {
      errors.push(`이미지 처리 오류: ${error.message}`);
      console.error('이미지 처리 오류:', error.message);
      result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
    }
  }

  return { content: result, featuredImageId, errors };
}

module.exports = { generateSingleImage, processImageMarkers };
