const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

// 환경 변수
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const WP_URL = process.env.WP_URL;
const WP_USER = process.env.WP_USER;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
const SERP_API_KEY = process.env.SERP_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // OpenAI DALL-E API

const keywordsPath = path.join(__dirname, "keywords.json");

// ============================================
// 1. 공식문서 도메인 목록
// ============================================
const OFFICIAL_DOMAINS = [
  // 기술 공식문서
  "docs.google.com", "developer.android.com", "developer.apple.com",
  "docs.microsoft.com", "learn.microsoft.com", "aws.amazon.com/docs",
  "cloud.google.com/docs", "docs.aws.amazon.com", "firebase.google.com/docs",
  "reactjs.org", "vuejs.org", "angular.io", "nodejs.org", "python.org",
  "developer.mozilla.org", "w3.org", "github.com/docs",
  // 정부/공공기관
  "gov.kr", "korea.kr", "mois.go.kr", "nts.go.kr", "hometax.go.kr",
  "nhis.or.kr", "nps.or.kr", "bokjiro.go.kr", "law.go.kr",
  // 금융
  "fss.or.kr", "kofia.or.kr", "kbstar.com", "shinhan.com", "wooribank.com",
  // 기타 공신력 있는 사이트
  "wikipedia.org", "namu.wiki", "terms.naver.com", "ko.dict.naver.com"
];

// ============================================
// 2. 구글 상위 노출 페이지 검색 (최근 3개월 + 공식문서 우선)
// ============================================
async function searchGoogle(keyword, options = {}) {
  const { recentOnly = true, officialFirst = true } = options;
  console.log(`🔍 "${keyword}" 구글 검색 중... (최근 3개월 필터: ${recentOnly})`);

  // 기본 검색 파라미터
  const params = new URLSearchParams({
    q: keyword,
    location: "South Korea",
    hl: "ko",
    gl: "kr",
    google_domain: "google.co.kr",
    num: "15", // 더 많은 결과를 가져와서 필터링
    api_key: SERP_API_KEY,
  });

  // 최근 3개월 필터 적용
  if (recentOnly) {
    params.append("tbs", "qdr:m3"); // m3 = 최근 3개월
  }

  const response = await fetch(
    `https://serpapi.com/search.json?${params.toString()}`
  );
  const data = await response.json();

  if (!data.organic_results) {
    console.log("⚠️ 최근 3개월 결과 없음, 전체 기간으로 재검색...");
    // 날짜 필터 없이 재검색
    return searchGoogle(keyword, { recentOnly: false, officialFirst });
  }

  let results = data.organic_results.map((result) => ({
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    position: result.position,
    date: result.date || null, // SerpAPI가 제공하는 날짜 정보
    isOfficial: OFFICIAL_DOMAINS.some(domain => result.link.includes(domain)),
  }));

  // 공식문서 우선 정렬
  if (officialFirst) {
    results = results.sort((a, b) => {
      if (a.isOfficial && !b.isOfficial) return -1;
      if (!a.isOfficial && b.isOfficial) return 1;
      return a.position - b.position;
    });
  }

  console.log(`📊 검색 결과: ${results.length}개 (공식문서: ${results.filter(r => r.isOfficial).length}개)`);

  return results.slice(0, 7);
}

// ============================================
// 3. 공식문서 전용 검색
// ============================================
async function searchOfficialDocs(keyword) {
  console.log(`📚 "${keyword}" 공식문서 검색 중...`);

  // 공식문서 사이트 한정 검색
  const siteQuery = `${keyword} (site:gov.kr OR site:or.kr OR site:go.kr OR site:docs.google.com OR site:developer.android.com)`;

  const params = new URLSearchParams({
    q: siteQuery,
    location: "South Korea",
    hl: "ko",
    gl: "kr",
    google_domain: "google.co.kr",
    num: "5",
    api_key: SERP_API_KEY,
  });

  try {
    const response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`
    );
    const data = await response.json();

    if (!data.organic_results || data.organic_results.length === 0) {
      console.log("⚠️ 공식문서 검색 결과 없음");
      return [];
    }

    return data.organic_results.map((result) => ({
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      isOfficial: true,
      source: "official_search",
    }));
  } catch (e) {
    console.log("⚠️ 공식문서 검색 실패:", e.message);
    return [];
  }
}

// ============================================
// 4. 상위 페이지 콘텐츠 스크래핑 (날짜 추출 포함)
// ============================================
async function fetchPageContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
    });

    if (!response.ok) return null;

    const html = await response.text();

    // 날짜 추출 시도 (다양한 형식)
    let publishDate = null;
    const datePatterns = [
      // meta 태그에서 추출
      /<meta[^>]*property="article:published_time"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="date"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="pubdate"[^>]*content="([^"]+)"/i,
      // 일반적인 날짜 형식
      /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/,
      /(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/,
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        publishDate = match[1];
        break;
      }
    }

    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
    const h2Tags = h2Matches
      .map((h) => h.replace(/<[^>]+>/g, "").trim())
      .slice(0, 10);

    return { textContent, h2Tags, publishDate, url };
  } catch (e) {
    return null;
  }
}

// ============================================
// 5. 날짜가 최근 3개월 이내인지 확인
// ============================================
function isWithinThreeMonths(dateStr) {
  if (!dateStr) return true; // 날짜 정보 없으면 일단 포함

  try {
    // 다양한 날짜 형식 파싱
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

// ============================================
// 6. 경쟁 분석 (공식문서 + 최근 정보 우선)
// ============================================
async function analyzeCompetitors(keyword, searchResults, officialDocs) {
  if (!searchResults && !officialDocs) {
    return {
      keyword,
      topTitles: [],
      commonH2: [],
      contentSummary: "검색 결과 분석 불가",
      officialSources: [],
      recentSources: [],
    };
  }

  const allResults = [...(searchResults || []), ...(officialDocs || [])];
  console.log(`📊 총 ${allResults.length}개 페이지 분석 중... (공식문서: ${(officialDocs || []).length}개)`);

  const topTitles = allResults.map((r) => r.title);
  const snippets = allResults.map((r) => r.snippet).join("\n");
  const allH2 = [];
  const officialSources = [];
  const recentSources = [];

  // 콘텐츠 분석 (공식문서 우선)
  const sortedResults = allResults.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return 0;
  });

  for (let i = 0; i < Math.min(5, sortedResults.length); i++) {
    const result = sortedResults[i];
    const content = await fetchPageContent(result.link);

    if (content) {
      if (content.h2Tags) {
        allH2.push(...content.h2Tags);
      }

      // 공식문서 소스 수집
      if (result.isOfficial) {
        officialSources.push({
          title: result.title,
          url: result.link,
          snippet: result.snippet,
          content: content.textContent.slice(0, 1000),
        });
      }

      // 최근 3개월 이내 콘텐츠 수집
      if (isWithinThreeMonths(content.publishDate)) {
        recentSources.push({
          title: result.title,
          url: result.link,
          date: content.publishDate,
          snippet: result.snippet,
        });
      }
    }
  }

  const h2Frequency = {};
  allH2.forEach((h2) => {
    const key = h2.toLowerCase();
    h2Frequency[key] = (h2Frequency[key] || 0) + 1;
  });

  const commonH2 = Object.entries(h2Frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h2]) => h2);

  console.log(`✅ 분석 완료 - 공식문서: ${officialSources.length}개, 최근 정보: ${recentSources.length}개`);

  return {
    keyword,
    topTitles,
    commonH2,
    snippets,
    officialSources,
    recentSources,
  };
}

// ============================================
// 7. DALL-E로 이미지 생성 (2개)
// ============================================
async function generateImages(keyword) {
  console.log(`🖼️ DALL-E로 이미지 2개 생성 중...`);

  // 키워드를 영어 프롬프트로 변환
  const promptMap = {
    "블로그": ["modern blog writing workspace with laptop, minimalist illustration style", "creative content creation concept, colorful abstract illustration"],
    "AI": ["artificial intelligence concept, neural network visualization, futuristic blue illustration", "robot and human collaboration, modern digital art style"],
    "자동화": ["automation concept, gears and flowing workflow, clean illustration", "efficiency and productivity concept, modern vector style"],
    "워드프레스": ["website design on screen, professional workspace illustration", "web development concept, modern flat design"],
    "SEO": ["search engine optimization concept, magnifying glass illustration", "website ranking growth chart, clean infographic style"],
    "글쓰기": ["creative writing concept, person with ideas, warm illustration", "storytelling concept, books and imagination, artistic style"],
    "수익": ["online business success, growth concept illustration", "financial success, coins and charts, modern design"],
    "애드센스": ["digital advertising concept, modern illustration", "monetization concept, website with revenue, clean design"],
    "프로그램": ["software development concept, clean illustration", "coding and technology, modern digital art"],
    "포스팅": ["content creation concept, social media illustration", "digital publishing, modern flat design"],
    "문화": ["cultural activities illustration, art and music concept", "leisure and entertainment, colorful modern style"],
    "카드": ["card payment concept, modern financial illustration", "digital card and benefits, clean design"],
    "신청": ["application process illustration, step by step guide", "form submission concept, helpful guide style"],
    "지원": ["support and assistance concept, helping hands illustration", "benefit program, friendly modern style"],
  };

  // 기본 프롬프트
  let prompts = [
    "modern informative blog concept, clean minimalist illustration, helpful guide style",
    "professional information concept, friendly modern illustration, educational style"
  ];

  // 키워드에 맞는 프롬프트 찾기
  for (const [korean, englishPrompts] of Object.entries(promptMap)) {
    if (keyword.includes(korean)) {
      prompts = englishPrompts;
      break;
    }
  }

  // 텍스트 없음 강조 문구
  const noTextClause = ", ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO WRITING, NO CHARACTERS, pure illustration only, clean visual without any typography";

  const images = [];

  for (let i = 0; i < 2; i++) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompts[i] + noTextClause + ", high quality, 16:9 aspect ratio",
          n: 1,
          size: "1792x1024",
          quality: "standard",
        }),
      });

      const data = await response.json();

      if (data.data && data.data.length > 0) {
        images.push({
          url: data.data[0].url,
          alt: `${keyword} 관련 이미지 ${i + 1}`,
        });
        console.log(`✅ 이미지 ${i + 1} 생성 완료`);
      }
    } catch (e) {
      console.log(`⚠️ 이미지 ${i + 1} 생성 실패:`, e.message);
    }
  }

  return images.length > 0 ? images : null;
}

// ============================================
// 9. 워드프레스에 이미지 업로드
// ============================================
async function uploadImageToWordPress(imageUrl, filename) {
  console.log(`📤 이미지 업로드 중...`);

  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

  // 이미지 다운로드
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();

  // 워드프레스에 업로드
  const response = await fetch(`${WP_URL}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "image/jpeg",
      "Content-Disposition": `attachment; filename="${filename}.jpg"`,
    },
    body: Buffer.from(imageBuffer),
  });

  if (!response.ok) {
    console.log("⚠️ 이미지 업로드 실패");
    return null;
  }

  const media = await response.json();
  console.log(`✅ 이미지 업로드 완료: ${media.source_url}`);

  return {
    id: media.id,
    url: media.source_url,
  };
}

// ============================================
// 8. Claude로 SEO 최적화 글 생성 (공식문서 + 최신정보 기반)
// ============================================
async function generateContent(keyword, analysis, imagesData) {
  const client = new Anthropic({ apiKey: CLAUDE_API_KEY });

  // 이미지 HTML 생성 (2개)
  let imageHtml1 = "";
  let imageHtml2 = "";
  if (imagesData && imagesData.length > 0) {
    imageHtml1 = `
<figure class="wp-block-image size-large">
  <img src="${imagesData[0].url}" alt="${keyword}" />
</figure>`;
    if (imagesData.length > 1) {
      imageHtml2 = `
<figure class="wp-block-image size-large">
  <img src="${imagesData[1].url}" alt="${keyword}" />
</figure>`;
    }
  }

  // 공식문서 정보 포맷팅
  const officialDocsInfo = analysis.officialSources && analysis.officialSources.length > 0
    ? analysis.officialSources.map(s => `- ${s.title}: ${s.snippet}`).join("\n")
    : "공식문서 검색 결과 없음";

  // 최신 정보 포맷팅
  const recentInfo = analysis.recentSources && analysis.recentSources.length > 0
    ? analysis.recentSources.map(s => `- [${s.date || '최근'}] ${s.title}: ${s.snippet}`).join("\n")
    : "최근 정보 없음";

  const systemPrompt = `당신은 10년 경력의 전문 블로그 작가이자 구글 SEO 전문가입니다.

## 핵심 원칙: 반드시 글을 작성해야 합니다!

### 중요: 글 작성 거부 금지!
- 검색 결과가 부족하더라도 반드시 글을 작성해야 합니다
- "정보가 부족합니다", "글을 작성할 수 없습니다" 등의 거부 메시지 절대 금지
- 제공된 웹 검색 결과를 최대한 활용하여 글을 작성하세요
- 검색 결과가 없어도 해당 주제에 대한 일반적인 정보로 글을 작성하세요

### 정보 활용 원칙
1. 제공된 웹 검색 결과를 우선 활용
2. 공식문서(gov.kr, or.kr 등)가 있으면 해당 정보 우선 참조
3. 2026년 현재 기준으로 최신 정보 작성
4. 구체적인 수치나 날짜가 있으면 포함
5. 정책/제도 관련 내용은 "자세한 내용은 공식 홈페이지를 확인하세요"로 안내

### 글쓰기 스타일
- 자연스러운 구어체 사용 ("~해요", "~거든요", "~더라고요")
- 개인 경험 포함 ("제가 직접 써보니", "솔직히 말하면")
- AI가 쓴 티가 나지 않도록 자연스럽게

### 절대 금지 사항 (매우 중요!)
- 이모지 절대 사용 금지
- 마크다운 문법 절대 사용 금지: ##, **, *, #, - 등
- 반드시 HTML 태그만 사용할 것

### HTML 형식 필수
- 본문에 h1 태그 절대 사용 금지! (제목은 title 필드에만 작성, 워드프레스가 자동으로 h1으로 표시함)
- 소제목: <h2>제목</h2> 형식 사용 (## 금지)
- 하위 소제목: <h3>제목</h3> 형식 사용
- 강조: <strong>텍스트</strong> 형식 사용 (** 금지)
- 문단: <p>텍스트</p> 형식 사용
- 목록: <ul><li>항목</li></ul> 형식 사용 (- 금지)

### 구글 SEO 최적화
- 제목: 키워드를 앞쪽에 배치, 55자 이내
- 첫 문단 100자 내에 키워드 포함
- H2 태그 3-5개, 각 H2에 키워드 자연스럽게 포함
- 키워드 밀도 1.5-2.5%
- 메타 설명: 키워드 포함, 150자 이내

### 글 구조
- 도입부: 2-3문장으로 독자 고민 공감
- [IMAGE_PLACEHOLDER_1] 태그를 도입부 바로 다음에 삽입
- 목차 (클릭 시 해당 섹션으로 이동): 도입부 다음에 목차 삽입
- 본론: H2 섹션 3-5개
- [IMAGE_PLACEHOLDER_2] 태그를 본문 중간(2번째 H2 섹션 뒤)에 삽입
- 본문 중간에 자연스럽게 "AI 블로그 자동화 프로그램"을 언급하며 내부 링크 삽입
- 결론: 핵심 요약 + 행동 유도
- 글 마지막에 [CTA_PLACEHOLDER] 태그 삽입
- 총 1500자 이상

### 목차 형식 (매우 중요!)
- 도입부 다음, 첫 번째 H2 전에 목차를 삽입
- 목차 형식 예시:
<div class="toc-box" style="background: #f8f9fa; border-left: 4px solid #667eea; padding: 20px 25px; margin: 25px 0; border-radius: 8px;">
<p style="font-weight: 700; margin-bottom: 10px; color: #333;">목차</p>
<ul style="list-style: none; padding: 0; margin: 0;">
<li style="margin: 8px 0;"><a href="#section-1" style="color: #667eea; text-decoration: none;">1. 소제목1</a></li>
<li style="margin: 8px 0;"><a href="#section-2" style="color: #667eea; text-decoration: none;">2. 소제목2</a></li>
</ul>
</div>
- H2 태그에 반드시 id 속성 추가: <h2 id="section-1">소제목1</h2>

### 공식 홈페이지 링크 버튼 (매우 중요!)
- 독자가 행동할 수 있는 시점(신청, 확인, 조회 등)에 공식 홈페이지 링크 버튼 삽입
- 형식: [OFFICIAL_LINK:공식사이트URL:버튼텍스트]
- 예시: [OFFICIAL_LINK:https://www.mnuri.kr:문화누리카드 공식 홈페이지 바로가기]
- 글 중간에 1-2개, 결론 부분에 1개 삽입
- 버튼 텍스트는 행동 유도형으로 작성 ("신청하러 가기", "자세히 알아보기", "공식 홈페이지에서 확인하기" 등)`;

  const userPrompt = `다음 키워드로 구글 SEO에 최적화된 블로그 글을 작성해주세요.

**키워드**: ${keyword}
**작성 기준일**: 2026년 2월 (현재 기준 최신 정보 사용)

## 웹 검색 결과 (참고용):
${officialDocsInfo !== "공식문서 검색 결과 없음" ? officialDocsInfo : ""}
${recentInfo !== "최근 정보 없음" ? recentInfo : ""}
${analysis.snippets || ""}

**경쟁 분석 결과**:
- 상위 노출 제목들: ${analysis.topTitles.join(" | ") || "없음"}
- 자주 사용되는 소제목: ${analysis.commonH2.join(", ") || "없음"}

**중요: 반드시 글을 작성하세요!**
- 검색 결과가 부족해도 해당 키워드에 대한 블로그 글을 반드시 작성해야 합니다
- "정보가 부족합니다" 등의 거부 메시지 절대 금지
- 2026년 현재 기준으로 작성하세요

**작성 요구사항**:

1. **제목 (55자 이내)**: 키워드를 앞쪽에 배치, 클릭 유도

2. **본문 구조**:
   - 도입부 (2-3문장): 독자 고민 공감, 첫 100자 내 키워드 포함
   - [IMAGE_PLACEHOLDER_1]
   - 목차 (클릭 시 해당 섹션으로 부드럽게 스크롤):
     <div class="toc-box" style="background: #f8f9fa; border-left: 4px solid #667eea; padding: 20px 25px; margin: 25px 0; border-radius: 8px;">
     <p style="font-weight: 700; margin-bottom: 10px; color: #333;">목차</p>
     <ul style="list-style: none; padding: 0; margin: 0;">
     <li style="margin: 8px 0;"><a href="#section-1" style="color: #667eea; text-decoration: none;">1. 소제목</a></li>
     </ul>
     </div>
   - H2 섹션 3-5개 (각 H2에 키워드 변형 포함, 반드시 id 속성 추가: <h2 id="section-1">소제목</h2>)
   - [IMAGE_PLACEHOLDER_2] (2번째 H2 섹션 뒤에 삽입)
   - 웹 검색 결과가 있으면 해당 정보 활용, 없으면 일반적인 정보로 작성
   - **공식 홈페이지 링크 버튼 필수**: 신청/조회/확인 등 행동이 필요한 시점에 삽입
     형식: [OFFICIAL_LINK:공식사이트URL:버튼텍스트]
     예: [OFFICIAL_LINK:https://www.mnuri.kr:문화누리카드 신청하러 가기]
   - 본문 중간에 자연스럽게 내부 링크 삽입: <a href="https://wpauto.kr/">AI 블로그 자동화 프로그램</a>
   - 결론: 핵심 3줄 요약 + 다음 행동 유도 + 공식 홈페이지 링크 버튼
   - 글 마지막에 [CTA_PLACEHOLDER] 태그 삽입

3. **절대 금지 - 마크다운 사용 금지**:
   - ## 사용 금지 → <h2>제목</h2> 사용
   - ** 사용 금지 → <strong>텍스트</strong> 사용
   - 이모지 사용 금지
   - 반드시 순수 HTML만 사용

4. **SEO 요소**:
   - 키워드 자연스럽게 7-10회 포함
   - 중요 키워드는 <strong>텍스트</strong> 태그로 강조

5. **1500자 이상 필수**

JSON 형식으로만 응답 (글 작성 거부 금지!):
{
  "title": "제목 (이모지 없이)",
  "metaDescription": "메타 설명 150자 이내 (키워드 포함)",
  "content": "HTML 본문 (이모지 없이, [IMAGE_PLACEHOLDER] 포함)"
}`;

  console.log("🤖 Claude로 글 생성 중...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 6000,
    messages: [{ role: "user", content: systemPrompt + "\n\n" + userPrompt }],
  });

  const text = response.content[0].text;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const article = JSON.parse(jsonMatch[0]);
      let content = article.content;

      console.log('🔧 후처리 시작...');

      // ============================================
      // 1단계: 마크다운 → HTML 변환
      // ============================================
      content = content
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>');

      // ============================================
      // 2단계: h1 태그 완전 제거
      // ============================================
      while (content.indexOf('<h1') !== -1) {
        const start = content.indexOf('<h1');
        const end = content.indexOf('</h1>', start);
        if (start !== -1 && end !== -1) {
          content = content.slice(0, start) + content.slice(end + 5);
        } else {
          // 닫는 태그가 없으면 여는 태그만 제거
          content = content.slice(0, start) + content.slice(start + 4);
          break;
        }
      }
      content = content.replace(/^# .+$/gm, '');
      console.log('✅ h1 태그 제거 완료');

      // ============================================
      // 3단계: Claude가 만든 목차 완전 제거
      // ============================================
      // 목차 h2와 그 뒤의 ul 모두 제거
      // 패턴: <h2...>목차</h2> 다음에 오는 <ul>...</ul>까지
      let tocRemoved = false;
      while (content.toLowerCase().indexOf('목차') !== -1) {
        // 목차가 포함된 h2 찾기
        const h2Start = content.search(/<h2[^>]*>[^<]*목차/i);
        if (h2Start === -1) break;

        const h2End = content.indexOf('</h2>', h2Start);
        if (h2End === -1) break;

        // h2 다음에 오는 ul 찾기
        const afterH2 = content.slice(h2End + 5);
        const ulStart = afterH2.search(/<ul/i);

        if (ulStart !== -1 && ulStart < 50) { // ul이 h2 바로 뒤에 있으면
          const ulEnd = afterH2.indexOf('</ul>');
          if (ulEnd !== -1) {
            // h2와 ul 모두 제거
            content = content.slice(0, h2Start) + afterH2.slice(ulEnd + 5);
            tocRemoved = true;
            continue;
          }
        }

        // ul이 없으면 h2만 제거
        content = content.slice(0, h2Start) + content.slice(h2End + 5);
        tocRemoved = true;
      }

      // toc-box 클래스가 있는 div도 제거
      while (content.indexOf('toc-box') !== -1) {
        const divStart = content.lastIndexOf('<div', content.indexOf('toc-box'));
        if (divStart === -1) break;
        const divEnd = content.indexOf('</div>', divStart);
        if (divEnd === -1) break;
        content = content.slice(0, divStart) + content.slice(divEnd + 6);
      }

      console.log('✅ 기존 목차 제거 완료');

      // ============================================
      // 4단계: 이미지 플레이스홀더 교체
      // ============================================
      content = content.replace('[IMAGE_PLACEHOLDER_1]', imageHtml1 || '');
      content = content.replace('[IMAGE_PLACEHOLDER_2]', imageHtml2 || '');

      // ============================================
      // 5단계: 모든 h2의 기존 id 제거하고 텍스트만 추출
      // ============================================
      const h2Data = [];
      let h2Count = 1;
      let searchStart = 0;

      while (true) {
        const h2OpenStart = content.indexOf('<h2', searchStart);
        if (h2OpenStart === -1) break;

        const h2OpenEnd = content.indexOf('>', h2OpenStart);
        if (h2OpenEnd === -1) break;

        const h2CloseStart = content.indexOf('</h2>', h2OpenEnd);
        if (h2CloseStart === -1) break;

        // h2 내부 텍스트 추출
        let h2Inner = content.slice(h2OpenEnd + 1, h2CloseStart);
        // 내부 태그 제거
        h2Inner = h2Inner.replace(/<[^>]+>/g, '').trim();

        // "목차" 포함된 것은 스킵
        if (h2Inner.includes('목차') || !h2Inner) {
          searchStart = h2CloseStart + 5;
          continue;
        }

        const newId = 'sec' + h2Count;
        h2Data.push({
          start: h2OpenStart,
          end: h2CloseStart + 5,
          text: h2Inner,
          id: newId
        });

        h2Count++;
        searchStart = h2CloseStart + 5;
      }

      // 뒤에서부터 교체 (인덱스 유지)
      for (let i = h2Data.length - 1; i >= 0; i--) {
        const item = h2Data[i];
        const newH2 = '<h2 id="' + item.id + '">' + item.text + '</h2>';
        content = content.slice(0, item.start) + newH2 + content.slice(item.end);
      }
      console.log('✅ ' + h2Data.length + '개 h2에 id 부여 완료');

      // ============================================
      // 6단계: 새 목차 HTML 생성 및 삽입
      // ============================================
      if (h2Data.length >= 2) {
        let tocLi = '';
        for (let i = 0; i < h2Data.length; i++) {
          tocLi += '<li style="margin:10px 0;"><a href="#' + h2Data[i].id + '" style="color:#667eea;text-decoration:none;">' + (i + 1) + '. ' + h2Data[i].text + '</a></li>';
        }

        const tocBox = '<div class="toc-box" style="background:linear-gradient(135deg,#f8f9fa 0%,#e9ecef 100%);border-left:4px solid #667eea;padding:25px 30px;margin:30px 0;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.05);">' +
          '<p style="font-weight:800;margin-bottom:15px;color:#333;font-size:1.1rem;">목차</p>' +
          '<ul style="list-style:none;padding:0;margin:0;">' + tocLi + '</ul></div>';

        // 첫 번째 h2 앞에 삽입
        const firstH2Pos = content.indexOf('<h2 id="' + h2Data[0].id + '">');
        if (firstH2Pos !== -1) {
          content = content.slice(0, firstH2Pos) + tocBox + content.slice(firstH2Pos);
        }
        console.log('✅ 목차 생성 완료 (' + h2Data.length + '개 항목, 링크 포함)');
      }

      // 부드러운 스크롤 CSS
      const smoothCss = '<style>html{scroll-behavior:smooth}.toc-box a:hover{text-decoration:underline!important;color:#764ba2!important}</style>';
      content = smoothCss + content;

      article.content = content;

      // 공식 홈페이지 링크 버튼 변환 [OFFICIAL_LINK:URL:텍스트] → HTML 버튼
      article.content = article.content.replace(
        /\[OFFICIAL_LINK:([^:]+):([^\]]+)\]/g,
        (match, url, text) => `
<div style="text-align: center; margin: 30px 0;">
  <a href="${url}" target="_self" style="display: inline-block; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: #fff; padding: 16px 40px; border-radius: 50px; font-weight: 700; text-decoration: none; font-size: 1.1rem; box-shadow: 0 8px 25px rgba(40, 167, 69, 0.3); transition: all 0.3s;">${text} →</a>
</div>`
      );

      // CTA 박스 추가 (메인 페이지로 유도)
      const ctaHtml = `
<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 50px 40px; border-radius: 20px; margin: 50px 0; text-align: center; box-shadow: 0 20px 60px rgba(102, 126, 234, 0.4);">
  <p style="color: rgba(255,255,255,0.8); font-size: 0.95rem; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 2px;">AI 블로그 자동화 솔루션</p>
  <h3 style="color: #fff; font-size: 1.8rem; margin-bottom: 15px; font-weight: 900;">블로그 글쓰기, AI가 대신해드립니다</h3>
  <p style="color: rgba(255,255,255,0.9); font-size: 1.1rem; margin-bottom: 30px; line-height: 1.7;">키워드 하나로 SEO 최적화 글 작성부터 워드프레스 자동 발행까지!<br><strong style="color: #ffd93d;">월정액 없이 평생 사용</strong>하세요.</p>
  <a href="https://wpauto.kr/" style="display: inline-block; background: #ffd93d; color: #1a1a2e; padding: 18px 50px; border-radius: 50px; font-weight: 800; text-decoration: none; font-size: 1.15rem; box-shadow: 0 10px 30px rgba(0,0,0,0.3); transition: all 0.3s;">무료 상담받기 →</a>
  <p style="color: rgba(255,255,255,0.6); font-size: 0.85rem; margin-top: 15px;">지금 바로 카카오톡으로 문의하세요</p>
</div>`;

      // 본문 중간 링크 버튼 추가
      const midCtaHtml = `
<div style="background: #f8f9fa; border: 2px solid #667eea; padding: 25px; border-radius: 15px; margin: 30px 0; text-align: center;">
  <p style="color: #333; font-size: 1.05rem; margin-bottom: 15px;">💡 <strong>시간 없이 블로그 운영하고 싶다면?</strong></p>
  <a href="https://wpauto.kr/" style="display: inline-block; background: #667eea; color: #fff; padding: 12px 30px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 1rem;">AI 자동화 프로그램 알아보기</a>
</div>`;

      // 본문 중간에 링크 버튼 삽입 (3번째 H2 태그 앞에)
      const h2Matches = article.content.match(/<h2[^>]*>/gi);
      if (h2Matches && h2Matches.length >= 3) {
        const thirdH2 = h2Matches[2];
        article.content = article.content.replace(thirdH2, midCtaHtml + thirdH2);
      }
      article.content = article.content.replace("[CTA_PLACEHOLDER]", ctaHtml);
      // CTA 플레이스홀더가 없는 경우 글 끝에 추가
      if (!article.content.includes(ctaHtml)) {
        article.content += ctaHtml;
      }

      // ============================================
      // 최종 h1 제거 (마지막 안전장치)
      // ============================================
      let finalContent = article.content;
      while (finalContent.indexOf('<h1') !== -1) {
        const s = finalContent.indexOf('<h1');
        const e = finalContent.indexOf('</h1>', s);
        if (s !== -1 && e !== -1) {
          finalContent = finalContent.slice(0, s) + finalContent.slice(e + 5);
        } else {
          break;
        }
      }
      article.content = finalContent;

      // 빈 줄 정리
      article.content = article.content.replace(/\n{3,}/g, '\n\n').trim();

      // 최종 h1 확인
      if (article.content.indexOf('<h1') !== -1) {
        console.log('⚠️ 경고: h1 태그 아직 존재! 강제 split 제거...');
        const parts = article.content.split('<h1');
        let result = parts[0];
        for (let i = 1; i < parts.length; i++) {
          const closeIdx = parts[i].indexOf('</h1>');
          if (closeIdx !== -1) {
            result += parts[i].slice(closeIdx + 5);
          } else {
            result += parts[i];
          }
        }
        article.content = result;
      }

      const contentLength = article.content.replace(/<[^>]+>/g, '').length;
      console.log('📏 글자수: ' + contentLength + '자');
      console.log('✅ 최종 처리 완료');

      // 디버그: h1과 목차 확인
      console.log('🔍 h1 태그 존재: ' + (article.content.indexOf('<h1') !== -1 ? 'YES' : 'NO'));
      console.log('🔍 목차 링크 존재: ' + (article.content.indexOf('href="#sec') !== -1 ? 'YES' : 'NO'));
      console.log('🔍 h2 id 존재: ' + (article.content.indexOf('id="sec') !== -1 ? 'YES' : 'NO'));

      return article;
    }
  } catch (e) {
    console.error("JSON 파싱 실패:", e);
  }

  return null;
}

// ============================================
// 10. 워드프레스 발행
// ============================================
async function postToWordPress(title, content, metaDescription, featuredImageId) {
  const auth = Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");

  const postData = {
    title: title,
    content: content,
    status: "publish",
    excerpt: metaDescription,
    meta: {
      _yoast_wpseo_metadesc: metaDescription,
    },
  };

  // 대표 이미지 설정
  if (featuredImageId) {
    postData.featured_media = featuredImageId;
  }

  const response = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`WordPress API 오류: ${response.status} - ${error}`);
  }

  return await response.json();
}

// ============================================
// 메인 실행
// ============================================
async function main() {
  console.log("═".repeat(50));
  console.log("🚀 SEO 최적화 자동 포스팅 시작");
  console.log("═".repeat(50));

  // 키워드 로드
  const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, "utf-8"));
  const { currentIndex, keywords } = keywordsData;

  if (currentIndex >= keywords.length) {
    console.log("✅ 모든 키워드 발행 완료!");
    return;
  }

  const keyword = keywords[currentIndex];
  console.log(`\n📌 키워드 ${currentIndex + 1}/${keywords.length}: "${keyword}"`);

  // Step 1: 구글 검색 (최근 3개월 필터 + 공식문서 우선)
  console.log("\n📍 Step 1: 최신 정보 검색 (최근 3개월)");
  const searchResults = await searchGoogle(keyword, { recentOnly: true, officialFirst: true });

  // Step 2: 공식문서 전용 검색
  console.log("\n📍 Step 2: 공식문서 검색");
  const officialDocs = await searchOfficialDocs(keyword);

  // Step 3: 경쟁 분석 (공식문서 + 최신 정보 포함)
  console.log("\n📍 Step 3: 종합 분석");
  const analysis = await analyzeCompetitors(keyword, searchResults, officialDocs);
  console.log(`✅ 분석 완료 - 상위 제목 ${analysis.topTitles.length}개, 공식문서 ${analysis.officialSources.length}개, 최신 정보 ${analysis.recentSources.length}개`);

  // Step 4: 이미지 생성 및 업로드 (2개)
  console.log("\n📍 Step 4: 이미지 생성 (2개)");
  let imagesData = [];
  let featuredImageId = null;

  const images = await generateImages(keyword);
  if (images && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      const uploaded = await uploadImageToWordPress(
        images[i].url,
        `blog-image-${Date.now()}-${i + 1}`
      );
      if (uploaded) {
        imagesData.push({
          url: uploaded.url,
          credit: "AI Generated",
          creditLink: "#",
        });
        // 첫 번째 이미지를 대표 이미지로 설정
        if (i === 0) {
          featuredImageId = uploaded.id;
        }
      }
    }
    console.log(`✅ 총 ${imagesData.length}개 이미지 업로드 완료`);
  }

  // Step 5: 글 생성 (공식문서 + 최신정보 기반)
  console.log("\n📍 Step 5: AI 글 생성 (공식문서 + 최신 정보 기반)");
  const article = await generateContent(keyword, analysis, imagesData);

  if (!article) {
    console.error("❌ 글 생성 실패");
    process.exit(1);
  }

  console.log(`✅ 글 생성 완료: "${article.title}"`);

  // Step 6: 워드프레스 발행
  console.log("\n📍 Step 6: 워드프레스 발행");
  const post = await postToWordPress(
    article.title,
    article.content,
    article.metaDescription,
    featuredImageId
  );

  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ 발행 완료!`);
  console.log(`📎 URL: ${post.link}`);
  console.log(`🖼️ 이미지: ${imagesData.length}개 포함`);
  console.log(`📊 진행률: ${currentIndex + 1}/${keywords.length}`);
  console.log(`${"═".repeat(50)}`);

  // 인덱스 업데이트
  keywordsData.currentIndex = currentIndex + 1;
  fs.writeFileSync(keywordsPath, JSON.stringify(keywordsData, null, 2));
}

main().catch((err) => {
  console.error("❌ 오류 발생:", err);
  process.exit(1);
});
