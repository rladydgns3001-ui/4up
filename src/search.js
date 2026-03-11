const axios = require('axios');

// ============================================
// 공식문서 도메인 목록
// ============================================
const OFFICIAL_DOMAINS = [
  // 정부/공공기관 (최우선)
  "gov.kr", "go.kr", "or.kr", "korea.kr",
  "mois.go.kr", "nts.go.kr", "hometax.go.kr",
  "nhis.or.kr", "nps.or.kr", "bokjiro.go.kr", "law.go.kr",
  "mss.go.kr", "bizinfo.go.kr", "sbiz.or.kr", "k-startup.go.kr",
  "kised.or.kr", "semas.or.kr", "kcci.or.kr", "sbdc.or.kr",
  "work.go.kr", "ei.go.kr", "comwel.or.kr", "kcomwel.or.kr",
  "kotra.or.kr", "kita.or.kr", "keit.re.kr", "kdata.or.kr",
  "molit.go.kr", "lh.or.kr", "khug.or.kr", "hf.go.kr",
  "moe.go.kr", "nrf.re.kr", "kosaf.go.kr", "academyinfo.go.kr",
  // 금융/보험
  "fss.or.kr", "kofia.or.kr", "kbstar.com", "shinhan.com", "wooribank.com",
  "kbfg.com", "hanabank.com", "ibk.co.kr", "nh.co.kr",
  // 기술 공식문서
  "docs.google.com", "developer.android.com", "developer.apple.com",
  "docs.microsoft.com", "learn.microsoft.com", "aws.amazon.com/docs",
  "cloud.google.com/docs", "docs.aws.amazon.com", "firebase.google.com/docs",
  "reactjs.org", "vuejs.org", "angular.io", "nodejs.org", "python.org",
  "developer.mozilla.org", "w3.org", "github.com/docs",
  // 기타 공신력 있는 사이트
  "wikipedia.org", "namu.wiki", "terms.naver.com", "ko.dict.naver.com"
];

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

// 공식문서 여부 확인
function isOfficialSource(url) {
  if (!url) return false;
  return OFFICIAL_DOMAINS.some(domain => url.includes(domain));
}

// 날짜가 최근 3개월 이내인지 확인
function isWithinThreeMonths(dateStr) {
  if (!dateStr) return true; // 날짜 정보 없으면 일단 포함

  try {
    let date;
    if (dateStr.includes("년")) {
      // 한국어 형식: 2024년 1월 15일
      const match = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (match) {
        date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      }
    } else {
      date = new Date(dateStr);
    }

    if (isNaN(date.getTime())) return true;

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    return date >= threeMonthsAgo;
  } catch (e) {
    return true;
  }
}

// DuckDuckGo 검색 (공식문서 우선)
async function searchWeb(keyword, count = 5) {
  try {
    // 일반 검색
    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    let results = [];

    // 정규식으로 검색 결과 파싱 (URL 포함)
    const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < count * 2) {
      const link = match[1];
      const title = stripHtml(match[2]);
      const snippet = stripHtml(match[3]);

      if (title && snippet) {
        results.push({
          title,
          snippet,
          link,
          isOfficial: isOfficialSource(link)
        });
      }
    }

    // 백업: 간단한 파싱
    if (results.length === 0) {
      const titleRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/g;
      const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const links = [];
      const titles = [];
      const snippets = [];

      let m;
      while ((m = titleRegex.exec(html)) !== null) {
        links.push(m[1]);
        titles.push(stripHtml(m[2]));
      }
      while ((m = snippetRegex.exec(html)) !== null) {
        snippets.push(stripHtml(m[1]));
      }

      for (let i = 0; i < Math.min(titles.length, snippets.length, count * 2); i++) {
        if (titles[i] && snippets[i]) {
          results.push({
            title: titles[i],
            snippet: snippets[i],
            link: links[i] || '',
            isOfficial: isOfficialSource(links[i])
          });
        }
      }
    }

    // 공식문서 우선 정렬
    results = results.sort((a, b) => {
      if (a.isOfficial && !b.isOfficial) return -1;
      if (!a.isOfficial && b.isOfficial) return 1;
      return 0;
    });

    console.log(`📊 검색 결과: ${results.length}개 (공식문서: ${results.filter(r => r.isOfficial).length}개)`);

    return results.slice(0, count);
  } catch (error) {
    console.error('검색 오류:', error.message);
    return [];
  }
}

// 공식문서 전용 검색
async function searchOfficialDocs(keyword, count = 3) {
  try {
    // 공식문서 사이트 한정 검색
    const siteQuery = `${keyword} site:gov.kr OR site:or.kr OR site:go.kr`;

    const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(siteQuery)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    const results = [];

    const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < count) {
      const link = match[1];
      const title = stripHtml(match[2]);
      const snippet = stripHtml(match[3]);

      if (title && snippet) {
        results.push({
          title,
          snippet,
          link,
          isOfficial: true,
          source: 'official_search'
        });
      }
    }

    console.log(`📚 공식문서 검색 결과: ${results.length}개`);
    return results;
  } catch (error) {
    console.error('공식문서 검색 오류:', error.message);
    return [];
  }
}

// 페이지 내용 가져오기 (날짜 추출 포함)
async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    let content = response.data;

    // 날짜 추출 시도
    let publishDate = null;
    const datePatterns = [
      /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="date"[^>]*content="([^"]+)"/i,
      /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/,
      /(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/,
    ];

    for (const pattern of datePatterns) {
      const match = content.match(pattern);
      if (match) {
        publishDate = match[1];
        break;
      }
    }

    // script, style 태그 제거
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[\s\S]*?<\/style>/gi, '');

    // HTML 태그 제거
    content = stripHtml(content);

    return {
      content: content.slice(0, 2000),
      publishDate,
      isRecent: isWithinThreeMonths(publishDate)
    };
  } catch (error) {
    console.error('페이지 가져오기 오류:', error.message);
    return { content: '', publishDate: null, isRecent: true };
  }
}

// ============================================
// 뉴스 검색 (Google News RSS)
// ============================================
async function searchNews(keyword, count = 5) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    });

    const xml = response.data;
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < count) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';

      const cleanTitle = title.replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/ - [^-]+$/, '').trim();
      const cleanLink = link.trim();

      if (cleanTitle && cleanLink) {
        items.push({ title: cleanTitle, url: cleanLink, pubDate: pubDate.trim(), source: source.trim() });
      }
    }

    console.log(`📰 뉴스 검색 결과: ${items.length}건`);
    return items;
  } catch (error) {
    console.error('뉴스 검색 오류:', error.message);
    return [];
  }
}

// 뉴스 기사 본문 가져오기
async function fetchNewsArticle(url, maxLength = 2500) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      },
      timeout: 12000,
      maxRedirects: 5
    });

    let content = response.data;

    // 날짜 추출
    let publishDate = null;
    const datePatterns = [
      /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="date"[^>]*content="([^"]+)"/i,
      /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/,
      /(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/,
    ];
    for (const pattern of datePatterns) {
      const m = content.match(pattern);
      if (m) { publishDate = m[1]; break; }
    }

    // script, style 태그 제거 후 텍스트 추출
    content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
    content = stripHtml(content);

    // 빈 줄 정리
    content = content.split('\n').map(l => l.trim()).filter(Boolean).join('\n');

    return {
      content: content.slice(0, maxLength),
      publishDate,
      isRecent: isWithinThreeMonths(publishDate)
    };
  } catch (error) {
    console.error('뉴스 기사 가져오기 오류:', error.message);
    return { content: '', publishDate: null, isRecent: true };
  }
}

// ============================================
// 검색 컨텍스트 생성 (뉴스 본문 + 공식문서 + 최신 정보)
// ============================================
async function getSearchContext(keyword, count = 3) {
  // 뉴스 검색 + 일반 검색 + 공식문서 검색 병렬 실행
  const [newsResults, generalResults, officialResults] = await Promise.all([
    searchNews(keyword, 5),
    searchWeb(keyword, count),
    searchOfficialDocs(keyword, 2)
  ]);

  let context = '';
  const officialSources = [];
  const recentSources = [];

  // ① 뉴스 기사 본문 포함 (최우선) — 병렬 처리
  if (newsResults.length > 0) {
    const topNews = newsResults.slice(0, 4);
    const articles = await Promise.all(topNews.map(news => fetchNewsArticle(news.url)));

    context += '=== 최신 뉴스 기사 ===\n\n';
    for (let i = 0; i < topNews.length; i++) {
      const news = topNews[i];
      const article = articles[i];

      context += `[뉴스 ${i + 1}] ${news.pubDate ? `(${news.pubDate})` : ''}\n`;
      context += `제목: ${news.title}\n`;
      context += `출처: ${news.source}\n`;
      if (article.content) {
        context += `본문:\n${article.content}\n`;
      }
      context += '\n---\n\n';

      if (article.isRecent) {
        recentSources.push({ title: news.title, snippet: article.content.slice(0, 150), date: article.publishDate || news.pubDate });
      }
    }
  }

  // ② 공식문서 + 일반 검색 결과 병합
  const webResults = [...officialResults];
  for (const r of generalResults) {
    if (!webResults.some(e => e.link === r.link)) webResults.push(r);
  }

  if (webResults.length > 0) {
    context += '=== 웹 검색 결과 ===\n\n';
    for (let i = 0; i < Math.min(webResults.length, count + 2); i++) {
      const r = webResults[i];
      let pageInfo = { isRecent: true, publishDate: null };
      if (r.link) pageInfo = await fetchPageContent(r.link);

      const sourceType = r.isOfficial ? '[공식문서]' : '[일반]';
      const dateInfo = pageInfo.publishDate ? `(${pageInfo.publishDate})` : '';

      context += `[검색결과 ${i + 1}] ${sourceType} ${dateInfo}\n`;
      context += `제목: ${r.title}\n`;
      context += `내용: ${r.snippet}\n\n`;

      if (r.isOfficial) {
        officialSources.push({ title: r.title, snippet: r.snippet, url: r.link });
      }
      if (pageInfo.isRecent && !recentSources.some(s => s.title === r.title)) {
        recentSources.push({ title: r.title, snippet: r.snippet, date: pageInfo.publishDate });
      }
    }
  }

  if (!context) {
    return { context: '검색 결과 없음', officialSources: [], recentSources: [] };
  }

  return { context, officialSources, recentSources };
}

module.exports = {
  searchWeb,
  searchNews,
  fetchPageContent,
  fetchNewsArticle,
  getSearchContext,
  searchOfficialDocs,
  isOfficialSource,
  isWithinThreeMonths,
  OFFICIAL_DOMAINS
};
