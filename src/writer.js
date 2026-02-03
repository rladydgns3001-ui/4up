const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

// 인라인 CSS 스타일 적용 함수
function applyInlineStyles(html) {
  // h1 스타일
  html = html.replace(/<h1(?:\s+style="[^"]*")?>/gi,
    '<h1 style="font-family:\'Nanum Gothic\',sans-serif;font-size:22px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:20px;">');

  // h2 스타일
  html = html.replace(/<h2(?:\s+style="[^"]*")?>/gi,
    '<h2 style="font-family:\'Nanum Gothic\',sans-serif;font-size:28px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:20px;">');

  // h3 스타일
  html = html.replace(/<h3(?:\s+style="[^"]*")?>/gi,
    '<h3 style="font-family:\'Nanum Gothic\',sans-serif;font-size:22px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:15px;">');

  // h4 스타일
  html = html.replace(/<h4(?:\s+style="[^"]*")?>/gi,
    '<h4 style="font-family:\'Nanum Gothic\',sans-serif;font-size:18px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:12px;">');

  // p 스타일 (공식 링크 버튼 제외)
  html = html.replace(/<p(?:\s+style="[^"]*")?>/gi,
    '<p style="font-size:17px;line-height:1.8;margin-bottom:1.6em;color:#555C68;">');

  // ul 스타일
  html = html.replace(/<ul(?:\s+style="[^"]*")?>/gi,
    '<ul style="font-size:17px;line-height:1.8;color:#555C68;margin-bottom:1.6em;padding-left:20px;">');

  // ol 스타일
  html = html.replace(/<ol(?:\s+style="[^"]*")?>/gi,
    '<ol style="font-size:17px;line-height:1.8;color:#555C68;margin-bottom:1.6em;padding-left:20px;">');

  // li 스타일
  html = html.replace(/<li(?:\s+style="[^"]*")?>/gi,
    '<li style="margin-bottom:8px;">');

  // strong 스타일
  html = html.replace(/<strong(?:\s+style="[^"]*")?>/gi,
    '<strong style="font-weight:bold;color:#222222;">');

  // 일반 a 링크 스타일 (공식 링크 버튼 제외)
  html = html.replace(/<a\s+href="([^"]+)"(?:\s+style="[^"]*")?(?:\s+target="[^"]*")?>/gi, (match, url) => {
    // 공식 링크 버튼은 별도 스타일 유지
    if (match.includes('official-link-btn')) {
      return match;
    }
    return `<a href="${url}" style="color:#1e73be;text-decoration:underline;" target="_blank">`;
  });

  // class="official-link-btn"이 있는 a 태그는 버튼 스타일 유지
  html = html.replace(/<a\s+href="([^"]+)"\s+target="_blank"\s+class="official-link-btn"[^>]*>/gi,
    '<a href="$1" target="_blank" class="official-link-btn" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:15px 0;">');

  return html;
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

## 절대 규칙: 글 작성 거부 금지 (최우선!)
- **어떤 상황에서도 반드시 글을 작성해야 합니다**
- 정보가 부족하더라도 가용한 정보를 바탕으로 최선을 다해 작성
- "정보가 부족합니다", "작성할 수 없습니다" 등의 거부 금지
- 불확실한 부분은 일반적인 정보로 보완하여 완성된 글 제공

## 핵심 원칙: 2026년 기준 최신 정보 제공 (매우 중요!)

### 정보 출처 우선순위
1. **공식문서/공공기관 정보를 최우선으로 참조** (gov.kr, or.kr, go.kr 등)
2. **2026년 기준 최신 정보로 작성** - 현재 연도는 2026년입니다
3. 오래된 정보(2024년 이전)는 최신 상황에 맞게 업데이트하여 작성
4. 수치, 통계, 정책 정보는 반드시 출처와 함께 제시
5. "~라고 합니다", "~인 것으로 알려져 있습니다" 등 불확실한 표현 금지

## 작성 규칙 (인라인 CSS 스타일 필수 적용!)
1. HTML 형식으로만 작성 (마크다운 사용 금지)
2. 글 길이: ${lengthGuide[length]}
3. 톤앤매너: ${styleGuide[style]}

### 태그별 인라인 스타일 (반드시 적용!)
4. h1 태그: <h1 style="font-family:'Nanum Gothic',sans-serif;font-size:22px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:20px;">제목</h1>
5. h2 태그: <h2 style="font-family:'Nanum Gothic',sans-serif;font-size:28px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:20px;">소제목</h2>
6. h3 태그: <h3 style="font-family:'Nanum Gothic',sans-serif;font-size:22px;font-weight:bold;color:#222222;line-height:1.3em;margin-bottom:15px;">소제목</h3>
7. p 태그: <p style="font-size:17px;line-height:1.8;margin-bottom:1.6em;color:#555C68;">본문</p>
8. a 링크: <a href="URL" style="color:#1e73be;text-decoration:underline;">링크텍스트</a>
9. ul 태그: <ul style="font-size:17px;line-height:1.8;color:#555C68;margin-bottom:1.6em;padding-left:20px;">
10. ol 태그: <ol style="font-size:17px;line-height:1.8;color:#555C68;margin-bottom:1.6em;padding-left:20px;">
11. li 태그: <li style="margin-bottom:8px;">항목</li>
12. strong 태그: <strong style="font-weight:bold;color:#222222;">강조</strong>

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

## 공식 홈페이지 링크 버튼 (필수!)
- 글 중간중간 행동을 유도해야 하는 시점에 공식 홈페이지 링크 버튼 삽입
- 버튼 형식: <a href="URL" target="_blank" class="official-link-btn" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:15px 0;">🔗 공식 홈페이지 바로가기</a>
- 예시 삽입 시점: "자세한 내용은 공식 홈페이지에서 확인하세요", "신청은 아래 링크에서 가능합니다" 등
- 제공된 공식문서 URL을 활용하여 버튼 생성
- 최소 2개 이상의 공식 링크 버튼 삽입

## 구조
1. 후킹 도입부 (독자의 관심 유도)
2. 📌 목차 (Table of Contents)
3. 본문 (H2, H3로 구조화) + 공식 링크 버튼 삽입
4. [AD] 마커 5개 삽입 (광고 위치)
5. FAQ 섹션
6. 마무리 및 CTA (공식 링크 버튼 포함)

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

    // 인라인 CSS 스타일 적용
    content = applyInlineStyles(content);

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
