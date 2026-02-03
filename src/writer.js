const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

// 메인 키워드에서 세부 키워드 3개 추출
async function generateSubKeywords(mainKeyword) {
  const client = new Anthropic({ apiKey: config.CLAUDE_API_KEY });

  const prompt = `메인 키워드: "${mainKeyword}"

이 키워드를 검색하는 사람들이 실제로 원하는 것을 분석해주세요.

## 분석 기준
1. **검색 의도 파악**: 이 키워드를 검색하는 사람은 무엇을 하려고 하는가?
   - 신청하려고? 확인하려고? 비교하려고? 방법을 알려고?
2. **행동 키워드 도출**: 독자가 취하고 싶은 행동은 무엇인가?
   - 신청방법, 자격조건, 신청기간, 지원금액, 신청서류 등
3. **세부 니즈 분석**: 구체적으로 어떤 정보가 필요한가?

## 출력 형식 (반드시 이 형식으로!)
---ANALYSIS---
독자 검색 의도: (한 줄 설명)
---KEYWORDS---
키워드1: (메인키워드 + 행동키워드 조합)
키워드2: (메인키워드 + 행동키워드 조합)
키워드3: (메인키워드 + 행동키워드 조합)

## 예시
메인 키워드가 "청년 주택드림 청약통장"인 경우:
---ANALYSIS---
독자 검색 의도: 청년 주택드림 청약통장에 가입하고 싶어서 자격 조건과 신청 방법을 알고 싶어함
---KEYWORDS---
키워드1: 청년 주택드림 청약통장 가입조건
키워드2: 청년 주택드림 청약통장 신청방법
키워드3: 청년 주택드림 청약통장 혜택 총정리`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;

    // 분석 결과 파싱
    const analysisMatch = text.match(/---ANALYSIS---\s*([\s\S]*?)---KEYWORDS---/);
    const keywordsMatch = text.match(/---KEYWORDS---\s*([\s\S]*)/);

    const analysis = analysisMatch ? analysisMatch[1].trim() : '';
    const keywordsText = keywordsMatch ? keywordsMatch[1].trim() : '';

    // 키워드 추출
    const keywords = [];
    const keywordLines = keywordsText.split('\n').filter(line => line.includes(':'));
    for (const line of keywordLines) {
      const match = line.match(/키워드\d+:\s*(.+)/);
      if (match) {
        keywords.push(match[1].trim());
      }
    }

    return {
      success: true,
      mainKeyword,
      analysis,
      subKeywords: keywords.slice(0, 3) // 최대 3개
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      mainKeyword,
      subKeywords: [mainKeyword] // 실패 시 메인 키워드만 반환
    };
  }
}

async function generateArticle(keyword, webContext = '', wpContext = '', style = 'informative', length = 'medium', searchData = null) {
  const client = new Anthropic({ apiKey: config.CLAUDE_API_KEY });

  const lengthGuide = {
    short: '500-800자',
    medium: '1000-1500자',
    long: '2000-3000자'
  };

  const styleGuide = {
    informative: '정보 전달에 초점, 객관적이고 신뢰감 있는 톤',
    casual: '친근하고 대화하듯이, 이모지 적극 활용',
    professional: '전문적이고 권위 있는 톤, 데이터와 근거 중심'
  };

  // 공식문서 정보 포맷팅
  const officialDocsInfo = searchData?.officialSources?.length > 0
    ? searchData.officialSources.map(s => `- ${s.title}: ${s.snippet}`).join('\n')
    : '공식문서 검색 결과 없음';

  // 최신 정보 포맷팅
  const recentInfo = searchData?.recentSources?.length > 0
    ? searchData.recentSources.map(s => `- [${s.date || '최근'}] ${s.title}: ${s.snippet}`).join('\n')
    : '최근 정보 없음';

  const systemPrompt = `당신은 구글 SEO에 최적화된 블로그 글을 작성하는 전문 작가입니다.

## 절대 규칙 1: 글 작성 거부 금지
- **어떤 상황에서도 반드시 글을 작성해야 합니다**
- 정보가 부족하더라도 가용한 정보를 바탕으로 최선을 다해 작성
- "정보가 부족합니다", "작성할 수 없습니다" 등의 거부 금지

## 절대 규칙 2: 링크 버튼 필수 삽입 (가장 중요!)
- **반드시 3개 이상의 링크 버튼을 본문에 삽입해야 합니다**
- **링크는 반드시 한국 웹사이트만 사용** (gov.kr, go.kr, or.kr, co.kr, kr 도메인)
- 독자가 이 키워드를 검색한 이유를 분석: 신청하려고? 확인하려고? 알아보려고?
- 독자의 행동 욕구를 자극하는 버튼 문구 사용
- **버튼은 반드시 중앙정렬** (div로 감싸서 text-align:center 적용)
- 버튼 형식 (반드시 이 형식 사용!):
  <div style="text-align:center;margin:20px 0;"><a href="한국웹사이트URL" class="official-link-btn" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">👉 지금 바로 신청하기</a></div>
- 버튼 배치: 도입부 직후 1개, 본문 중간 1개, 마무리 전 1개
- **target 속성 절대 사용 금지** (현재 창에서 이동)

## 핵심 원칙: 2026년 기준 최신 정보 제공 (매우 중요!)

### 정보 출처 우선순위
1. **공식문서/공공기관 정보를 최우선으로 참조** (gov.kr, or.kr, go.kr 등)
2. **2026년 기준 최신 정보로 작성** - 현재 연도는 2026년입니다
3. 오래된 정보(2024년 이전)는 최신 상황에 맞게 업데이트하여 작성
4. 수치, 통계, 정책 정보는 반드시 출처와 함께 제시
5. "~라고 합니다", "~인 것으로 알려져 있습니다" 등 불확실한 표현 금지

## 작성 규칙
1. HTML 형식으로만 작성 (마크다운 사용 금지)
2. 글 길이: ${lengthGuide[length]}
3. 톤앤매너: ${styleGuide[style]}
4. **본문에 절대 <h1> 태그 사용 금지** (워드프레스가 제목을 자동으로 h1으로 표시함)
5. 소제목은 <h2>, <h3> 태그 사용
6. 문단은 <p> 태그 사용
7. 목록은 <ul>, <ol> 태그 사용
8. 중요 키워드는 <strong> 태그로 강조

## 이모지 사용 규칙 (적절히 사용)
- 📌 : 목차, 핵심 요약, 중요 포인트 섹션 앞에 사용
- 🚨 : 주의사항, 위험, 경고 내용 앞에 사용
- ✅ : 체크리스트, 긍정적 항목, 장점 목록에 사용
- 이모지는 과하지 않게, 섹션 구분과 강조 목적으로만 사용
- 일반 본문에는 이모지 사용 자제

## SEO 최적화
- 키워드를 제목, 첫 문단, 소제목에 자연스럽게 포함
- 메타 설명용 요약문 제공 (150자 이내)
- FAQ 섹션 포함 (2-3개 질문)

## 정보 신뢰성 필수
- 제공된 공식문서 정보를 우선적으로 활용
- 최근 3개월 이내 정보만 사용
- 오래된 정보, 불확실한 정보 사용 금지
- 구체적인 날짜, 수치, 출처 포함

## 링크 버튼 행동 유도 문구 예시
- "신청 방법이 궁금하시죠?" → 👉 지금 바로 신청하기
- "자격이 되는지 확인해보세요" → ✅ 자격 조건 확인하기
- "더 자세한 내용은 공식 사이트에서" → 📋 공식 홈페이지 바로가기
- "놓치지 마세요!" → 🔥 혜택 확인하러 가기
- "마감 전에 서두르세요" → ⏰ 신청 마감일 확인하기

## 구조
1. 후킹 도입부 (독자의 관심 유도)
2. 📌 목차 (Table of Contents) - **각 항목에 앵커 링크 필수** (예: <a href="#sec1">1. 첫번째 소제목</a>)
3. 본문 (H2, H3로 구조화) + 공식 링크 버튼 삽입 - **각 H2에 id 속성 필수** (예: <h2 id="sec1">첫번째 소제목</h2>)
4. [AD] 마커 5개 삽입 (광고 위치)
5. FAQ 섹션
6. 마무리 및 CTA (공식 링크 버튼 포함)

## 목차 형식 예시 (반드시 이 형식으로!)
<div class="toc-container">
<p><strong>📌 목차</strong></p>
<ul>
<li><a href="#sec1">1. 첫번째 소제목</a></li>
<li><a href="#sec2">2. 두번째 소제목</a></li>
</ul>
</div>

## H2 태그 형식 예시 (반드시 id 포함!)
<h2 id="sec1">첫번째 소제목</h2>
<h2 id="sec2">두번째 소제목</h2>

## 출력 형식
---TITLE---
글 제목
---META---
메타 설명 (150자 이내)
---CONTENT---
HTML 본문`;

  // 공식 URL 목록 포맷팅
  const officialUrls = searchData?.officialSources?.length > 0
    ? searchData.officialSources.map(s => `- ${s.title}: ${s.url}`).join('\n')
    : '공식 URL 없음';

  const userPrompt = `키워드: ${keyword}
작성 기준일: 2026년 (현재 연도는 2026년입니다. 2026년 기준 최신 정보로 작성)

## 참고할 공식문서/공신력 있는 출처:
${officialDocsInfo}

## 공식 홈페이지 URL (버튼 링크용):
${officialUrls}

## 최근 3개월 이내 최신 정보:
${recentInfo}

웹 검색 결과:
${webContext || '없음'}

기존 블로그 글 참고:
${wpContext || '없음'}

위 정보를 참고하여 SEO 최적화된 블로그 글을 작성해주세요.

**필수 체크리스트**:
1. ✅ 링크 버튼 3개 이상 삽입했는가? (공식 URL 사용)
2. ✅ 독자가 클릭하고 싶은 행동 유도 문구인가?
3. ✅ h1 태그 없이 h2부터 시작했는가?
4. ✅ 목차에 앵커 링크가 있는가?`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      system: systemPrompt
    });

    const text = response.content[0].text;

    // 파싱
    const titleMatch = text.match(/---TITLE---\s*([\s\S]*?)\s*---META---/);
    const metaMatch = text.match(/---META---\s*([\s\S]*?)\s*---CONTENT---/);
    const contentMatch = text.match(/---CONTENT---\s*([\s\S]*)/);

    const title = titleMatch ? titleMatch[1].trim() : keyword;
    const meta = metaMatch ? metaMatch[1].trim() : '';
    let content = contentMatch ? contentMatch[1].trim() : text;

    // [AD] 마커를 애드센스 코드로 교체
    content = content.replace(/\[AD\]/g, config.getAdsenseCode());

    // === 후처리: h1 태그 완전 제거 ===
    content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');

    // === 후처리: 목차와 h2 앵커 링크 자동 생성 ===
    const h2Matches = [];
    let h2Index = 0;
    content = content.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs, text) => {
      h2Index++;
      const id = `sec${h2Index}`;
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      h2Matches.push({ id, text: cleanText });
      // id 속성이 없으면 추가
      if (!attrs.includes('id=')) {
        return `<h2 id="${id}"${attrs}>${text}</h2>`;
      }
      return match;
    });

    // 목차가 없거나 링크가 없으면 자동 생성
    if (h2Matches.length > 0 && !content.includes('href="#sec')) {
      const tocHtml = `<div class="toc-container" style="background:#f8f9fa;padding:20px;border-radius:10px;margin:20px 0;">
<p><strong>📌 목차</strong></p>
<ul style="list-style:none;padding-left:0;">
${h2Matches.map((h, i) => `<li style="margin:8px 0;"><a href="#${h.id}" style="color:#667eea;text-decoration:none;">${i + 1}. ${h.text}</a></li>`).join('\n')}
</ul>
</div>`;

      // 기존 목차 제거 후 새 목차 삽입
      content = content.replace(/<div[^>]*class="toc-container"[^>]*>[\s\S]*?<\/div>/gi, '');
      content = content.replace(/(<p[^>]*>.*?📌\s*목차.*?<\/p>[\s\S]*?<\/ul>)/gi, '');

      // 첫 번째 p 태그 또는 본문 시작 부분에 목차 삽입
      const firstPIndex = content.indexOf('<p');
      if (firstPIndex !== -1) {
        content = content.slice(0, firstPIndex) + tocHtml + content.slice(firstPIndex);
      } else {
        content = tocHtml + content;
      }
    }

    return {
      success: true,
      title,
      meta,
      content,
      sourcesUsed: {
        official: searchData?.officialSources?.length || 0,
        recent: searchData?.recentSources?.length || 0
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { generateArticle, generateSubKeywords };
