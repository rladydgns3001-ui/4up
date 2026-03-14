const axios = require('axios');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('sharp 모듈 로드 실패 — 텍스트 오버레이 비활성화:', e.message);
  sharp = null;
}

/**
 * DALL-E 3 이미지 생성 + WordPress 업로드 모듈
 * Python image_generator.py 핵심 로직의 Node.js 포팅
 */

const DALLE_API_URL = 'https://api.openai.com/v1/images/generations';

/**
 * 사용 가능한 한글 폰트 경로 탐색
 */
function findFontPath() {
  const candidates = [];

  // 1. 번들된 폰트 (dev: fonts/, build: resources/fonts/)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'fonts', 'NanumGothicBold.ttf'));
  }
  candidates.push(path.join(__dirname, '..', 'fonts', 'NanumGothicBold.ttf'));

  // 2. Windows 시스템 폰트
  candidates.push('C:\\Windows\\Fonts\\malgun.ttf');
  candidates.push('C:\\Windows\\Fonts\\gulim.ttc');

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 텍스트 자동 줄바꿈 (maxChars자 기준, 최대 maxLines줄)
 */
function wrapText(text, maxChars = 18, maxLines = 2) {
  const lines = [];
  let remaining = text;

  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = '';
    } else {
      // 공백 기준 줄바꿈 시도
      let breakIdx = remaining.lastIndexOf(' ', maxChars);
      if (breakIdx <= 0) breakIdx = maxChars;
      lines.push(remaining.slice(0, breakIdx).trim());
      remaining = remaining.slice(breakIdx).trim();
    }
  }

  // 초과 시 마지막 줄에 "..." 추가
  if (remaining.length > 0 && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > maxChars - 3
      ? last.slice(0, maxChars - 3) + '...'
      : last + '...';
  }

  return lines;
}

/**
 * 이미지 버퍼에 제목 텍스트 오버레이 합성
 * @param {Buffer} imageBuffer - 원본 이미지 버퍼
 * @param {string} title - 오버레이할 제목 텍스트
 * @returns {Promise<Buffer>} - 합성된 PNG 버퍼
 */
async function addTextOverlay(imageBuffer, title) {
  if (!sharp) return imageBuffer;

  const fontPath = findFontPath();
  if (!fontPath) {
    console.log('한글 폰트 없음 — 텍스트 오버레이 스킵');
    return imageBuffer;
  }

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // 텍스트 줄바꿈
    const lines = wrapText(title, 18, 2);
    const fontSize = Math.round(width * 0.048);
    const lineHeight = fontSize * 1.4;
    const gradientHeight = Math.round(height * 0.4);
    const textBlockHeight = lines.length * lineHeight;
    const textStartY = height - Math.round(height * 0.08) - textBlockHeight;

    // SVG 텍스트 요소 생성
    const textElements = lines.map((line, idx) => {
      const y = textStartY + (idx * lineHeight) + fontSize;
      const escapedLine = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-size="${fontSize}" font-weight="bold" font-family="NanumGothic, Malgun Gothic, 맑은 고딕, Apple SD Gothic Neo, sans-serif" fill="white" stroke="rgba(0,0,0,0.3)" stroke-width="1">${escapedLine}</text>`;
    }).join('\n    ');

    // 폰트를 base64로 인코딩하여 SVG에 임베드
    const fontBuffer = fs.readFileSync(fontPath);
    const fontBase64 = fontBuffer.toString('base64');
    const fontExt = fontPath.endsWith('.ttc') ? 'collection' : 'truetype';

    const svgOverlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'NanumGothic';
        src: url('data:font/${fontExt};base64,${fontBase64}');
        font-weight: bold;
      }
    </style>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.7)" />
    </linearGradient>
  </defs>
  <rect x="0" y="${height - gradientHeight}" width="${width}" height="${gradientHeight}" fill="url(#grad)" />
  ${textElements}
</svg>`;

    const result = await sharp(imageBuffer)
      .composite([{
        input: Buffer.from(svgOverlay),
        top: 0,
        left: 0
      }])
      .png()
      .toBuffer();

    console.log(`텍스트 오버레이 완료: "${lines.join(' / ')}"`);
    return result;
  } catch (error) {
    console.error('텍스트 오버레이 실패 — 원본 사용:', error.message);
    return imageBuffer;
  }
}

/**
 * DALL-E 3용 프롬프트 생성 (텍스트 없는 일러스트)
 */
function buildDallePrompt(description) {
  return `3D clay render illustration in BankSalad style: ${description}. Chunky inflated 3D plastic objects with soft rounded edges, glossy clay-like material finish. Soft gradient background using purple-to-blue or mint-to-teal or pink-to-purple color scheme. Single spotlight lighting with gentle shadows. Minimalist composition with 1-2 main objects only. CRITICAL: absolutely NO text, NO letters, NO words, NO numbers, NO Korean, NO signs, NO labels, NO watermarks, NO captions anywhere in the image. The image must be completely free of any written content. No people, no faces, no hands holding documents. Clean studio background with smooth gradient. High quality 3D render, soft ambient occlusion.`;
}

/**
 * DALL-E 3로 단일 이미지 생성
 */
async function generateWithDalle(description) {
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OpenAI API 키가 설정되지 않았습니다.' };
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
 * 나노바나나(Gemini Imagen)로 단일 이미지 생성
 */
async function generateWithNanoBanana(description) {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Gemini API 키가 설정되지 않았습니다.' };
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-preview-image-generation',
    });

    const prompt = `Generate a high-quality blog illustration: ${description}. 3D clay render style with chunky inflated objects, soft rounded edges, glossy clay-like material. Soft gradient background. Clean, modern, minimal style. No text, no letters, no watermarks, no Korean characters in the image.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    });

    const response = result.response;
    if (!response.candidates?.[0]?.content?.parts) {
      return { success: false, error: '나노바나나 응답이 비어있습니다.' };
    }
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        // base64 이미지를 임시 파일로 저장 후 URL 반환
        const tmpPath = path.join(require('os').tmpdir(), `nanobanana-${Date.now()}.png`);
        fs.writeFileSync(tmpPath, Buffer.from(part.inlineData.data, 'base64'));
        return { success: true, filePath: tmpPath };
      }
    }

    return { success: false, error: '나노바나나 응답에 이미지가 없습니다.' };
  } catch (error) {
    const msg = error.message || String(error);
    console.error('나노바나나 이미지 생성 오류:', msg);
    return { success: false, error: msg };
  }
}

/**
 * 설정에 따라 이미지 생성 (DALL-E 3 또는 나노바나나)
 * @param {string} description - 이미지 설명 (영어)
 * @returns {Promise<{success: boolean, url?: string, filePath?: string, error?: string}>}
 */
async function generateSingleImage(description) {
  if (config.IMAGE_MODEL === 'nanobanana') {
    return generateWithNanoBanana(description);
  }
  return generateWithDalle(description);
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

  const isNanoBanana = config.IMAGE_MODEL === 'nanobanana';
  if (!isNanoBanana && !config.OPENAI_API_KEY) {
    for (let i = 0; i < imageMarkers.length; i++) {
      result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
    }
    return { content: result, featuredImageId, errors: ['OpenAI API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.'] };
  }
  if (isNanoBanana && !config.GEMINI_API_KEY) {
    for (let i = 0; i < imageMarkers.length; i++) {
      result = result.replace(`<!--IMAGE_PLACEHOLDER_${i}-->`, '');
    }
    return { content: result, featuredImageId, errors: ['Gemini API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.'] };
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

      // 이미지 버퍼 가져오기 (URL 다운로드 또는 로컬 파일)
      let imageBuffer;
      if (imgGen.filePath) {
        imageBuffer = fs.readFileSync(imgGen.filePath);
        try { fs.unlinkSync(imgGen.filePath); } catch {} // 임시 파일 삭제
      } else {
        const imageResponse = await axios.get(imgGen.url, {
          responseType: 'arraybuffer',
          timeout: 30000
        });
        imageBuffer = Buffer.from(imageResponse.data);
      }

      // 텍스트 오버레이 제거 — 원본 이미지 그대로 사용

      // 버퍼로 WP 업로드
      const imgResult = await wp.uploadImageBuffer(imageBuffer, filename + '.png', 'image/png');

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

module.exports = { generateSingleImage, processImageMarkers, addTextOverlay };
