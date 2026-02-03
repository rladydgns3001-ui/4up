const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

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

## 핵심 원칙: 신뢰할 수 있는 정보 제공 (매우 중요!)

### 정보 출처 우선순위
1. **공식문서/공공기관 정보를 최우선으로 참조**
2. **최근 3개월 이내의 최신 정보만 사용**
3. 오래된 정보나 확인되지 않은 정보는 절대 포함하지 않음
4. 수치, 통계, 정책 정보는 반드시 출처와 함께 제시
5. "~라고 합니다", "~인 것으로 알려져 있습니다" 등 불확실한 표현 금지

## 작성 규칙
1. HTML 형식으로만 작성 (마크다운 사용 금지)
2. 글 길이: ${lengthGuide[length]}
3. 톤앤매너: ${styleGuide[style]}
4. 제목은 <h1> 태그 사용
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

## 구조
1. 후킹 도입부 (독자의 관심 유도)
2. 📌 목차 (Table of Contents)
3. 본문 (H2, H3로 구조화)
4. [AD] 마커 5개 삽입 (광고 위치)
5. FAQ 섹션
6. 마무리 및 CTA

## 출력 형식
---TITLE---
글 제목
---META---
메타 설명 (150자 이내)
---CONTENT---
HTML 본문`;

  const userPrompt = `키워드: ${keyword}
작성 기준일: ${new Date().toISOString().split('T')[0]} (이 날짜 기준 최신 정보 사용)

## 참고할 공식문서/공신력 있는 출처:
${officialDocsInfo}

## 최근 3개월 이내 최신 정보:
${recentInfo}

웹 검색 결과:
${webContext || '없음'}

기존 블로그 글 참고:
${wpContext || '없음'}

위 정보를 참고하여 SEO 최적화된 블로그 글을 작성해주세요.
**중요**: 반드시 공식문서와 최신 정보를 바탕으로 작성하고, 확인되지 않은 정보는 절대 포함하지 마세요.`;

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

module.exports = { generateArticle };
