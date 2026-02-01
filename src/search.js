const axios = require('axios');

// HTML 태그 제거
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

// DuckDuckGo 검색
async function searchWeb(keyword, count = 5) {
  try {
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    const results = [];

    // 정규식으로 검색 결과 파싱
    const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < count) {
      const link = match[1];
      const title = stripHtml(match[2]);
      const snippet = stripHtml(match[3]);

      if (title && snippet) {
        results.push({ title, snippet, link });
      }
    }

    // 백업: 간단한 파싱
    if (results.length === 0) {
      const titleRegex = /<a class="result__a"[^>]*>([^<]+)<\/a>/g;
      const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles = [];
      const snippets = [];

      let m;
      while ((m = titleRegex.exec(html)) !== null) {
        titles.push(stripHtml(m[1]));
      }
      while ((m = snippetRegex.exec(html)) !== null) {
        snippets.push(stripHtml(m[1]));
      }

      for (let i = 0; i < Math.min(titles.length, snippets.length, count); i++) {
        if (titles[i] && snippets[i]) {
          results.push({
            title: titles[i],
            snippet: snippets[i],
            link: ''
          });
        }
      }
    }

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

    // 간단한 텍스트 추출
    let content = response.data;

    // script, style 태그 제거
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[\s\S]*?<\/style>/gi, '');

    // HTML 태그 제거
    content = stripHtml(content);

    return content.slice(0, 2000);
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
