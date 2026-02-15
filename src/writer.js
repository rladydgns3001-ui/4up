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

async function generateArticle(keyword, webContext = '', wpContext = '', style = 'informative', length = 'medium', searchData = null, keywordSettings = null) {
  const client = new Anthropic({ apiKey: config.CLAUDE_API_KEY });

  const lengthGuide = {
    short: '1500-2000자',
    medium: '2500-3500자',
    long: '4000-5000자'
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

  const systemPrompt = `당신은 Google SEO 전문 블로그 작가입니다.
주어진 키워드로 검색하는 독자의 니즈를 정확히 파악하여 글을 작성합니다.

## 최우선 규칙: 반드시 글을 작성해야 합니다!
- 검색 결과가 부족하거나 없어도 반드시 블로그 글을 작성해야 합니다
- "정보가 부족합니다", "글을 작성할 수 없습니다" 등의 거부 메시지 절대 금지
- 웹 검색 결과가 있으면 해당 정보 활용, 없으면 일반적인 정보로 작성
- 2026년 현재 기준으로 최신 정보 작성
- 정책/제도 관련은 "자세한 내용은 공식 홈페이지를 확인하세요" 안내 추가

## 글 구조 (반드시 이 순서로 작성)

1. 후킹 (공감 유도): 독자의 고민/문제를 1인칭으로 공감 ("저도 처음에 이거 보고 당황했어요")
2. CTA 버튼: 키워드와 관련된 공식 사이트 링크 버튼 (독자가 클릭할 수밖에 없는 문구)
3. 목차: 글의 섹션을 앵커 링크로 제공
4. 기본 개념 설명: H2로 "~란? ~기본 개념" 형태
5. [IMAGE:키워드와 관련된 이미지 설명] ← 이미지 위치 1 (기본 개념 설명 후)
6. 세부 내용: H2로 각 주제별 상세 설명 (표 활용)
7. 실제 예시: 숫자나 구체적 사례로 설명
8. 체크리스트: 독자가 확인해야 할 핵심 포인트
9. 핵심 요약 3줄 정리: 📌 이모지로 3줄 요약
10. 자주 묻는 질문 (FAQ): 3-5개 Q&A

## 이미지 삽입 규칙 (매우 중요!)
- 본문 중 적절한 위치에 **반드시 1개의 이미지 마커**를 삽입하세요
- 형식: [IMAGE:이미지에 대한 구체적인 설명]
- 설명은 영어로 작성 (DALL-E 이미지 생성용)
- ⚠️ **절대 금지 장면** (글자가 자동 생성되므로):
  - 가게, 상점, 거리, 간판이 있는 장면
  - 서류, 문서, 계약서, 신청서를 들고 있는 장면
  - 컴퓨터 화면, 스마트폰 화면이 보이는 장면
  - 책, 메뉴판, 포스터가 보이는 장면
- ✅ **권장 장면** (글자가 생기지 않음):
  - 추상적 아이콘/도형 일러스트 (플랫 디자인)
  - 자연 풍경, 하늘, 꽃밭 배경의 사람 실루엣
  - 동전, 화살표, 그래프 등 추상 오브젝트
  - 건물 전경 (멀리서 본 스카이라인)
  - 사람의 손, 악수, 하이파이브 등 클로즈업
- 예시:
  - 키워드 "소상공인 바우처" → [IMAGE:abstract flat illustration of golden coins and a gift voucher icon floating above an open hand, soft pastel gradient background, minimalist design]
  - 키워드 "청년 전세대출" → [IMAGE:minimalist illustration of a small house icon with a golden key and upward arrow, soft blue and white gradient background, flat design style]
  - 키워드 "종합소득세 절세" → [IMAGE:abstract flat design of a piggy bank with coins and a downward tax arrow, cheerful pastel colors, clean minimalist style]
- 이미지는 본문의 핵심 내용을 시각적으로 보여주는 위치에 배치

## 말투 규칙

- 1인칭 경험담 사용: "저도 처음엔...", "제가 직접 해보니..."
- 질문형 도입: "이거 뭔지 아시나요?", "왜 이렇게 되는 걸까요?"
- 짧고 강렬한 문장과 긴 설명 문장 혼합
- 독자에게 직접 말하기: "여러분이 알아야 할...", "꼭 확인하세요"
- 친근하지만 정보 전달 시 존댓말 사용

## 이모지 활용 (필수)

- ✔ 또는 ✅: 체크 항목, 완료된 것
- 📌: 핵심 포인트, 중요 정보
- 🚨: 주의사항, 경고
- ❌: 하지 말아야 할 것, 틀린 것
- 👉: 안내, 다음 단계
- 💡: 팁, 아이디어

## HTML 형식 규칙 (필수 - 마크다운 금지)

⚠️ 절대 마크다운 문법 사용 금지! **굵게**, *기울임*, # 제목 등 마크다운 사용하지 마세요.
반드시 순수 HTML 태그만 사용하세요:

- <h2>: 각 섹션 제목 (키워드 포함, 질문형 또는 "~하는 법" 형태) - **반드시 id 속성 포함** (예: <h2 id="sec1">)
- <h3>: 세부 항목
- <p>: 일반 문단
- <table>: 비교, 항목 설명에 활용. **반드시 인라인 스타일 포함!** 예시:
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;">
    <thead><tr style="background:#667eea;color:#fff;">
      <th style="padding:12px 16px;text-align:left;border:1px solid #ddd;">항목</th>
    </tr></thead>
    <tbody><tr style="background:#f9f9f9;">
      <td style="padding:12px 16px;border:1px solid #ddd;">내용</td>
    </tr></tbody>
  </table>
  - <th>: 보라색 배경(#667eea) + 흰 글씨 + border + padding 필수
  - <td>: border + padding 필수, 짝수 행은 background:#f9f9f9
  - 테이블 스타일 없이 <table> 태그만 쓰는 것은 금지
- <ul>, <li>: 체크리스트, 나열
- <strong>: 굵게 강조 (**사용 금지, <strong> 사용)
- <em>: 기울임 강조
- <a>: CTA 버튼 (class="official-link-btn" 포함)

## CTA 버튼 형식 (공식 홈페이지 링크 - 매우 중요!)

독자가 행동할 수 있는 시점(신청, 확인, 조회 등)에 공식 홈페이지 링크 버튼을 삽입하세요.
- **링크는 반드시 한국 웹사이트만 사용** (gov.kr, go.kr, or.kr, co.kr, kr 도메인)
- **target 속성 절대 사용 금지** (현재 창에서 이동)
- **버튼은 반드시 중앙정렬**
- 버튼 형식:
  <div style="text-align:center;margin:20px 0;"><a href="한국웹사이트URL" class="official-link-btn" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">👉 버튼텍스트</a></div>
- 버튼 배치: 도입부 직후 1개, 본문 중간 1개, 마무리 전 1개 (총 3개 이상)
${keywordSettings?.ctaUrl ? `\n⚠️ 사용자가 CTA 버튼 URL과 문구를 직접 지정했습니다. 모든 CTA 버튼에 반드시 사용자가 지정한 URL과 문구를 사용하세요:\n- URL: ${keywordSettings.ctaUrl}\n- 버튼 문구: ${keywordSettings.ctaText || '자세히 알아보기'}\n` : ''}

## 목차 형식 (반드시 이 형식!)
<div class="toc-container">
<p><strong>📌 목차</strong></p>
<ul>
<li><a href="#sec1">1. 첫번째 소제목</a></li>
<li><a href="#sec2">2. 두번째 소제목</a></li>
</ul>
</div>

## Google SEO 최적화 규칙

- 제목: 키워드 포함 + 독자 니즈 자극 (60자 이내)
- H2 제목에 키워드 자연스럽게 포함
- 첫 문단에 핵심 키워드 포함
- **본문에 절대 <h1> 태그 사용 금지** (워드프레스가 제목을 자동으로 h1으로 표시함)

## 목표 길이: ${lengthGuide[length] || lengthGuide.medium}
## 톤앤매너: ${styleGuide[style] || styleGuide.informative}

## 출력 형식
---TITLE---
글 제목 (SEO 최적화, 60자 이내)
---META---
메타 설명 (150자 이내, 클릭 유도)
---CONTENT---
글 본문 (순수 HTML만 사용, 마크다운 문법 절대 금지)

⚠️ 중요: 글을 끝까지 완성하세요. 중간에 끊지 마세요. FAQ 섹션까지 모두 작성해야 합니다.`;

  // 공식 URL 목록 포맷팅
  const officialUrls = searchData?.officialSources?.length > 0
    ? searchData.officialSources.map(s => `- ${s.title}: ${s.url}`).join('\n')
    : '공식 URL 없음';

  // 키워드별 참고 자료 포맷팅
  let keywordRefSection = '';
  if (keywordSettings?.referenceContent) {
    keywordRefSection += `\n## 사용자 제공 참고 자료 (최우선 반영):\n${keywordSettings.referenceContent}\n`;
  }
  if (keywordSettings?.referenceUrlContent) {
    keywordRefSection += `\n## 사용자 지정 참고 URL 내용:\n${keywordSettings.referenceUrlContent}\n`;
  }

  const userPrompt = `키워드: ${keyword}
작성 기준일: 2026년 (현재 연도는 2026년입니다. 2026년 기준 최신 정보로 작성)
${keywordRefSection}
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

위 정보를 바탕으로 "${keyword}" 키워드로 검색하는 독자에게 최적화된 블로그 글을 작성해주세요.

**필수 체크리스트**:
1. ✅ 링크 버튼 3개 이상 삽입했는가? (공식 한국 URL 사용)
2. ✅ [IMAGE:설명] 마커 1개를 본문에 삽입했는가?
3. ✅ h1 태그 없이 h2부터 시작했는가?
4. ✅ 목차에 앵커 링크가 있는가?
5. ✅ FAQ 섹션까지 완성했는가?

⚠️ 중요: 검색 결과가 부족해도 반드시 글을 작성해야 합니다. 글 작성 거부는 절대 금지입니다.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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

    // === 후처리: h1 태그 완전 제거 ===
    content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');

    // === 후처리: 이미지 마커 추출 ===
    const imageMarkers = [];
    content = content.replace(/\[IMAGE:([^\]]+)\]/g, (match, description) => {
      const placeholder = `<!--IMAGE_PLACEHOLDER_${imageMarkers.length}-->`;
      imageMarkers.push(description.trim());
      return placeholder;
    });

    // === 후처리: 목차와 h2 앵커 링크 자동 생성 ===
    const h2Matches = [];
    let h2Index = 0;
    content = content.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (match, attrs, text) => {
      h2Index++;
      const id = `sec${h2Index}`;
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      h2Matches.push({ id, text: cleanText });
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
      imageMarkers,
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
