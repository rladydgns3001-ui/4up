#!/usr/bin/env node
/**
 * test-keyword.js — Electron 없이 CLI에서 키워드별 설정 기능 테스트
 *
 * 사용법:
 *   node test-keyword.js --api-key sk-ant-... --keyword "청년 전세대출"
 *   node test-keyword.js --api-key sk-ant-... --keyword "청년 전세대출" \
 *     --reference "2026년 청년 전세대출 금리 2.5%로 인하" \
 *     --ref-url "https://www.hf.go.kr" \
 *     --cta-text "전세대출 신청하기" \
 *     --cta-url "https://www.hf.go.kr/apply"
 *
 * 출력: test-output.html
 */

const fs = require('fs');
const path = require('path');

// ===== CLI 인자 파싱 =====
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--api-key': opts.apiKey = args[++i]; break;
      case '--keyword': opts.keyword = args[++i]; break;
      case '--reference': opts.reference = args[++i]; break;
      case '--ref-url': opts.refUrl = args[++i]; break;
      case '--cta-text': opts.ctaText = args[++i]; break;
      case '--cta-url': opts.ctaUrl = args[++i]; break;
      case '--style': opts.style = args[++i]; break;
      case '--length': opts.length = args[++i]; break;
      case '--help':
        console.log(`
사용법: node test-keyword.js --api-key <KEY> --keyword <KEYWORD> [옵션]

필수:
  --api-key <KEY>       Claude API 키
  --keyword <KEYWORD>   테스트할 키워드

선택:
  --reference <TEXT>    참고 내용 (AI에게 전달할 참고 정보)
  --ref-url <URL>       참고 URL (해당 URL 내용을 참고자료로 사용)
  --cta-text <TEXT>     CTA 버튼 문구
  --cta-url <URL>       CTA 버튼 링크
  --style <STYLE>       글 스타일 (informative|casual|professional, 기본: informative)
  --length <LENGTH>     글 길이 (short|medium|long, 기본: medium)
        `);
        process.exit(0);
    }
  }
  return opts;
}

// ===== 메인 실행 =====
async function main() {
  const opts = parseArgs();

  if (!opts.apiKey) {
    console.error('❌ --api-key 필수입니다. --help 참조');
    process.exit(1);
  }
  if (!opts.keyword) {
    console.error('❌ --keyword 필수입니다. --help 참조');
    process.exit(1);
  }

  const keyword = opts.keyword;
  const style = opts.style || 'informative';
  const length = opts.length || 'medium';

  // keywordSettings 구성
  const keywordSettings = {};
  if (opts.reference) keywordSettings.referenceContent = opts.reference;
  if (opts.ctaText) keywordSettings.ctaText = opts.ctaText;
  if (opts.ctaUrl) keywordSettings.ctaUrl = opts.ctaUrl;

  const hasSettings = Object.keys(keywordSettings).length > 0;

  console.log('='.repeat(50));
  console.log('🔧 AutoPost 키워드별 설정 테스트');
  console.log('='.repeat(50));
  console.log(`📝 키워드: ${keyword}`);
  console.log(`📐 스타일: ${style} | 길이: ${length}`);
  if (hasSettings) {
    console.log('📌 키워드별 설정:');
    if (keywordSettings.referenceContent) console.log(`   참고내용: ${keywordSettings.referenceContent}`);
    if (keywordSettings.ctaText) console.log(`   CTA 문구: ${keywordSettings.ctaText}`);
    if (keywordSettings.ctaUrl) console.log(`   CTA URL: ${keywordSettings.ctaUrl}`);
  } else {
    console.log('📌 키워드별 설정: 없음 (기본 동작)');
  }
  console.log('='.repeat(50));

  // search.js는 Electron 의존성이 없으므로 직접 사용 가능
  const { getSearchContext, fetchPageContent } = require('./src/search');

  // 1. 참고 URL 내용 가져오기
  if (opts.refUrl) {
    console.log(`\n🔗 참고 URL 가져오는 중: ${opts.refUrl}`);
    try {
      const refPage = await fetchPageContent(opts.refUrl);
      keywordSettings.referenceUrlContent = refPage.content || '';
      console.log(`   ✅ ${keywordSettings.referenceUrlContent.length}자 가져옴`);
    } catch (e) {
      console.log(`   ⚠️ 참고 URL 가져오기 실패: ${e.message}`);
    }
  }

  // 2. 웹 검색
  console.log('\n🔍 웹 검색 중...');
  let searchData = null;
  try {
    searchData = await getSearchContext(keyword);
    console.log(`   ✅ 검색 완료 (공식: ${searchData.officialSources?.length || 0}개, 최근: ${searchData.recentSources?.length || 0}개)`);
  } catch (e) {
    console.log(`   ⚠️ 검색 실패 (AI 자동 생성으로 진행): ${e.message}`);
    searchData = { context: '', officialSources: [], recentSources: [] };
  }

  // 3. AI 글 생성 — writer.js의 generateArticle을 config mock으로 호출
  console.log('\n🤖 AI 글 생성 중...');

  // writer.js는 config.CLAUDE_API_KEY를 내부에서 사용하므로,
  // config 모듈을 mock해서 generateArticle 호출
  const configModule = require('./src/config');
  // config 모듈의 캐시된 설정을 오버라이드
  const originalGetConfigData = configModule.getConfig;
  let mockApiKey = opts.apiKey;

  // config.js는 getter 기반이므로, generateArticle 내부에서 config.CLAUDE_API_KEY 참조 시
  // Electron app.getPath() 호출됨. 테스트에서는 writer.js를 직접 사용할 수 없으므로
  // Anthropic SDK를 직접 사용하여 writer.js의 프롬프트 로직을 호출
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: opts.apiKey });

  const webContext = searchData.context || '';

  // writer.js의 프롬프트 로직 재사용 (동일한 구조)
  const lengthGuide = { short: '1500-2000자', medium: '2500-3500자', long: '4000-5000자' };
  const styleGuide = {
    informative: '정보 전달에 초점, 객관적이고 신뢰감 있는 톤',
    casual: '친근하고 대화하듯이, 이모지 적극 활용',
    professional: '전문적이고 권위 있는 톤, 데이터와 근거 중심'
  };

  const officialDocsInfo = searchData?.officialSources?.length > 0
    ? searchData.officialSources.map(s => `- ${s.title}: ${s.snippet}`).join('\n')
    : '공식문서 검색 결과 없음';

  const recentInfo = searchData?.recentSources?.length > 0
    ? searchData.recentSources.map(s => `- [${s.date || '최근'}] ${s.title}: ${s.snippet}`).join('\n')
    : '최근 정보 없음';

  const officialUrls = searchData?.officialSources?.length > 0
    ? searchData.officialSources.map(s => `- ${s.title}: ${s.url}`).join('\n')
    : '공식 URL 없음';

  const ctaOverride = keywordSettings?.ctaUrl
    ? `\n⚠️ 사용자가 CTA 버튼 URL과 문구를 직접 지정했습니다. 모든 CTA 버튼에 반드시 사용자가 지정한 URL과 문구를 사용하세요:\n- URL: ${keywordSettings.ctaUrl}\n- 버튼 문구: ${keywordSettings.ctaText || '자세히 알아보기'}\n`
    : '';

  const systemPrompt = `당신은 Google SEO 전문 블로그 작가입니다.
주어진 키워드로 검색하는 독자의 니즈를 정확히 파악하여 글을 작성합니다.

## 최우선 규칙: 반드시 글을 작성해야 합니다!
- 검색 결과가 부족하거나 없어도 반드시 블로그 글을 작성해야 합니다
- "정보가 부족합니다", "글을 작성할 수 없습니다" 등의 거부 메시지 절대 금지
- 웹 검색 결과가 있으면 해당 정보 활용, 없으면 일반적인 정보로 작성
- 2026년 현재 기준으로 최신 정보 작성
- 정책/제도 관련은 "자세한 내용은 공식 홈페이지를 확인하세요" 안내 추가

## 글 구조 (반드시 이 순서로 작성)

1. 후킹 (공감 유도): 독자의 고민/문제를 1인칭으로 공감
2. CTA 버튼: 키워드와 관련된 공식 사이트 링크 버튼
3. 목차: 글의 섹션을 앵커 링크로 제공
4. 기본 개념 설명: H2로 "~란? ~기본 개념" 형태
5. [IMAGE:키워드와 관련된 이미지 설명] ← 이미지 위치 1
6. 세부 내용: H2로 각 주제별 상세 설명 (표 활용)
7. 실제 예시: 숫자나 구체적 사례로 설명
8. 체크리스트: 독자가 확인해야 할 핵심 포인트
9. 핵심 요약 3줄 정리: 📌 이모지로 3줄 요약
10. 자주 묻는 질문 (FAQ): 3-5개 Q&A

## 이미지 삽입 규칙
- 본문 중 적절한 위치에 **반드시 1개의 이미지 마커**를 삽입하세요
- 형식: [IMAGE:이미지에 대한 구체적인 설명]
- 설명은 영어로 작성 (DALL-E 이미지 생성용)
- **이미지에 텍스트/글자/숫자/문자가 포함되지 않는 순수 일러스트레이션으로 설명하세요**
- 설명에 반드시 "no text, no letters, no words, no writing" 포함

## HTML 형식 규칙 (필수 - 마크다운 금지)

⚠️ 절대 마크다운 문법 사용 금지! 반드시 순수 HTML 태그만 사용하세요:

- <h2>: 각 섹션 제목 - **반드시 id 속성 포함** (예: <h2 id="sec1">)
- <h3>: 세부 항목
- <p>: 일반 문단
- <table>: 비교, 항목 설명에 활용. **반드시 인라인 스타일 포함!**
- <ul>, <li>: 체크리스트, 나열
- <strong>: 굵게 강조
- <a>: CTA 버튼 (class="official-link-btn" 포함)

## CTA 버튼 형식 (공식 홈페이지 링크 - 매우 중요!)

독자가 행동할 수 있는 시점에 공식 홈페이지 링크 버튼을 삽입하세요.
- **버튼은 반드시 중앙정렬**
- 버튼 형식:
  <div style="text-align:center;margin:20px 0;"><a href="URL" class="official-link-btn" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">👉 버튼텍스트</a></div>
- 버튼 배치: 도입부 직후 1개, 본문 중간 1개, 마무리 전 1개 (총 3개 이상)
${ctaOverride}
## 목표 길이: ${lengthGuide[length] || lengthGuide.medium}
## 톤앤매너: ${styleGuide[style] || styleGuide.informative}

## 출력 형식
---TITLE---
글 제목 (SEO 최적화, 60자 이내)
---META---
메타 설명 (150자 이내, 클릭 유도)
---CONTENT---
글 본문 (순수 HTML만 사용, 마크다운 문법 절대 금지)

⚠️ 중요: 글을 끝까지 완성하세요. FAQ 섹션까지 모두 작성해야 합니다.`;

  // userPrompt 구성
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

위 정보를 바탕으로 "${keyword}" 키워드로 검색하는 독자에게 최적화된 블로그 글을 작성해주세요.

**필수 체크리스트**:
1. ✅ 링크 버튼 3개 이상 삽입했는가?
2. ✅ [IMAGE:설명] 마커 1개를 본문에 삽입했는가?
3. ✅ h1 태그 없이 h2부터 시작했는가?
4. ✅ 목차에 앵커 링크가 있는가?
5. ✅ FAQ 섹션까지 완성했는가?

⚠️ 중요: 검색 결과가 부족해도 반드시 글을 작성해야 합니다.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: userPrompt }],
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

    // h1 태그 제거
    content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');

    // 이미지 마커 → 플레이스홀더 표시 (실제 이미지 생성 생략)
    content = content.replace(/\[IMAGE:([^\]]+)\]/g, (match, desc) => {
      return `<div style="margin:20px 0;padding:40px;background:#f0f4ff;border:2px dashed #667eea;border-radius:10px;text-align:center;color:#667eea;">🖼️ 이미지 위치: ${desc}</div>`;
    });

    // 결과 출력
    console.log('\n' + '='.repeat(50));
    console.log('✅ 글 생성 완료!');
    console.log('='.repeat(50));
    console.log(`📌 제목: ${title}`);
    console.log(`📝 메타 설명: ${meta}`);
    console.log(`📊 소스: 공식문서 ${searchData?.officialSources?.length || 0}개, 최근 ${searchData?.recentSources?.length || 0}개`);

    if (hasSettings) {
      console.log('\n📎 키워드별 설정 반영 확인:');
      if (keywordSettings.ctaUrl) {
        const ctaCount = (content.match(new RegExp(keywordSettings.ctaUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        console.log(`   CTA URL (${keywordSettings.ctaUrl}): 본문에 ${ctaCount}회 포함`);
      }
      if (keywordSettings.referenceContent) {
        console.log(`   참고내용: 프롬프트에 포함됨 ✅`);
      }
    }

    // HTML 파일 생성
    const htmlOutput = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${meta}">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.8; color: #333; }
    h2 { color: #333; margin-top: 30px; padding-bottom: 10px; border-bottom: 2px solid #667eea; }
    h3 { color: #555; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #667eea; color: #fff; padding: 12px 16px; text-align: left; border: 1px solid #ddd; }
    td { padding: 12px 16px; border: 1px solid #ddd; }
    tr:nth-child(even) { background: #f9f9f9; }
    .official-link-btn { display: inline-block; background: linear-gradient(135deg, #667eea, #764ba2); color: white !important; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; }
    .toc-container { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
    .toc-container a { color: #667eea; text-decoration: none; }
    .test-info { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; }
    .test-info strong { color: #856404; }
  </style>
</head>
<body>
  <div class="test-info">
    <strong>🔧 테스트 출력</strong> | 키워드: ${keyword} | 스타일: ${style} | 길이: ${length}
    ${hasSettings ? `<br>📎 키워드별 설정: ${keywordSettings.referenceContent ? '참고내용 ✅' : ''} ${keywordSettings.ctaUrl ? 'CTA ✅' : ''} ${keywordSettings.referenceUrlContent ? '참고URL ✅' : ''}` : ''}
  </div>
  <h1>${title}</h1>
  ${content}
</body>
</html>`;

    const outputPath = path.join(__dirname, 'test-output.html');
    fs.writeFileSync(outputPath, htmlOutput, 'utf8');
    console.log(`\n📄 HTML 출력: ${outputPath}`);
    console.log('   브라우저에서 열어서 확인하세요.');

  } catch (error) {
    console.error(`\n❌ AI 생성 오류: ${error.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
