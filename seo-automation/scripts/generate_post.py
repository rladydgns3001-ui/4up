"""
Claude API로 SEO/AEO/GEO 최적화 블로그 포스트 생성
"""
import json
import os
from datetime import datetime

import anthropic

POST_TYPES = ["guide", "comparison", "qna", "case_study", "tutorial"]

POST_TYPE_LABELS = {
    "guide": "실전 가이드",
    "comparison": "비교 분석",
    "qna": "Q&A 총정리",
    "case_study": "활용 사례",
    "tutorial": "단계별 튜토리얼",
}

CTA_HTML = """
<div style="background:linear-gradient(135deg,#2563EB 0%,#1e40af 100%);border-radius:16px;padding:32px;margin:40px 0;text-align:center;color:#fff;">
<h3 style="margin:0 0 12px;font-size:22px;color:#fff;">네이버 블로그 자동화, 지금 시작하세요</h3>
<p style="margin:0 0 20px;font-size:15px;opacity:0.9;">AI가 키워드 분석부터 포스팅까지 자동으로 처리합니다</p>
<a href="https://wpauto.kr/naver" target="_blank" rel="noopener" style="display:inline-block;background:#fff;color:#2563EB;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:16px;">자세히 알아보기 →</a>
</div>
"""


def _get_post_type(day_of_year: int) -> str:
    """날짜 기반 포스팅 타입 로테이션"""
    return POST_TYPES[day_of_year % len(POST_TYPES)]


def _build_prompt(keyword: str, post_type: str, crawled_data: dict) -> str:
    """Claude 프롬프트 생성"""
    type_label = POST_TYPE_LABELS[post_type]

    # 크롤링된 소제목/표현 요약 (표절 방지용)
    existing_headings = []
    existing_phrases = []
    for r in crawled_data.get("results", []):
        for h in r.get("headings", []):
            existing_headings.append(h["text"])
        for p in r.get("paragraphs", [])[:5]:
            existing_phrases.append(p[:80])

    avoid_section = ""
    if existing_headings:
        avoid_section = f"""
## 표절 방지 - 아래 소제목/표현은 절대 사용 금지
기존 글 소제목: {json.dumps(existing_headings[:20], ensure_ascii=False)}
기존 글 표현: {json.dumps(existing_phrases[:10], ensure_ascii=False)}
"""

    return f"""당신은 한국어 SEO 전문 블로그 라이터입니다.

## 작성 조건
- 타겟 키워드: "{keyword}"
- 포스팅 타입: {type_label}
- 분량: 2000자 이상
- 말투: 전문적이지만 친근한 ~입니다 체

## SEO 최적화
- 제목에 타겟 키워드 포함
- H2 소제목 4~6개, 그 중 2개 이상에 키워드 포함
- 본문에서 키워드 자연스럽게 3~5회 사용
- meta_description: 150자 이내, 키워드 포함

## AEO 최적화 (Answer Engine Optimization)
- FAQ 5개 작성 (질문형 소제목)
- 각 답변 50~100자, 명확하고 구체적
- "~란?", "~방법", "~차이" 등 질문형

## GEO 최적화 (Generative Engine Optimization)
- 구체적 수치 3개 이상 포함 (시간, 비용, 효율 등)
- 비교 데이터나 통계 활용
- 단계별 설명 포함

{avoid_section}

## 출력 형식 (JSON만 출력, 다른 텍스트 없이)
{{
  "title": "블로그 제목 (키워드 포함, 40자 이내)",
  "content": "HTML 본문 (H2, H3, p, ul, ol, strong, table 태그 사용. div/style 인라인 스타일 금지)",
  "excerpt": "요약문 (100자 이내)",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "meta_description": "메타 설명 (150자 이내, 키워드 포함)",
  "faq": [
    {{"question": "질문1", "answer": "답변1"}},
    {{"question": "질문2", "answer": "답변2"}},
    {{"question": "질문3", "answer": "답변3"}},
    {{"question": "질문4", "answer": "답변4"}},
    {{"question": "질문5", "answer": "답변5"}}
  ]
}}

중요: JSON만 출력하세요. 코드블록(```)이나 설명 텍스트 없이 순수 JSON만 반환하세요.
"""


def _build_faq_schema(faqs: list) -> str:
    """FAQPage JSON-LD Schema Markup 생성"""
    items = []
    for faq in faqs:
        items.append({
            "@type": "Question",
            "name": faq["question"],
            "acceptedAnswer": {
                "@type": "Answer",
                "text": faq["answer"],
            },
        })

    schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": items,
    }
    return f'<script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>'


def generate_post(keyword: str, crawled_data: dict, post_type: str | None = None) -> dict:
    """Claude API로 포스트 생성"""
    if post_type is None:
        post_type = _get_post_type(datetime.now().timetuple().tm_yday)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = _build_prompt(keyword, post_type, crawled_data)

    print(f"  [AI] Generating {POST_TYPE_LABELS[post_type]} for '{keyword}'...")

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = message.content[0].text.strip()

    # JSON 파싱 (코드블록 제거)
    if response_text.startswith("```"):
        response_text = response_text.split("```")[1]
        if response_text.startswith("json"):
            response_text = response_text[4:]
    response_text = response_text.strip()

    post = json.loads(response_text)

    # FAQ Schema 생성 및 CTA 삽입
    faq_schema = _build_faq_schema(post.get("faq", []))
    post["faq_schema"] = faq_schema
    post["content"] = post["content"] + "\n" + CTA_HTML + "\n" + faq_schema
    post["post_type"] = post_type
    post["keyword"] = keyword

    print(f"  [DONE] Title: {post['title']}")
    return post


if __name__ == "__main__":
    # 테스트용
    test_data = {"results": []}
    result = generate_post("네이버 블로그 자동화", test_data, "guide")
    print(json.dumps(result, ensure_ascii=False, indent=2)[:500])
