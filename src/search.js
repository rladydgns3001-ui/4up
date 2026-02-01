const axios = require('axios');
const cheerio = require('cheerio');

// DuckDuckGo 검색
async function searchWeb(keyword, count = 5) {
  try {
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $('.result').slice(0, count).each((i, el) => {
      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const link = $(el).find('.result__url').text().trim();

      if (title && snippet) {
        results.push({ title, snippet, link });
      }
    });

    return results;
  } catch (error) {
    console.error('검색 오류:', error.message);
    return [];
  }
}

// 페이지 내용 가져오기
async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    // 불필요한 요소 제거
    $('script, style, nav, header, footer, aside').remove();

    // 본문 추출
    const content = $('article, main, .content, .post-content, body').first().text();

    return content.replace(/\s+/g, ' ').trim().slice(0, 2000);
  } catch (error) {
    console.error('페이지 가져오기 오류:', error.message);
    return '';
  }
}

// 검색 컨텍스트 생성
async function getSearchContext(keyword, count = 3) {
  const results = await searchWeb(keyword, count);

  if (results.length === 0) {
    return '검색 결과 없음';
  }

  let context = '';
  results.forEach((r, i) => {
    context += `[검색결과 ${i + 1}]\n`;
    context += `제목: ${r.title}\n`;
    context += `내용: ${r.snippet}\n\n`;
  });

  return context;
}

module.exports = { searchWeb, fetchPageContent, getSearchContext };
