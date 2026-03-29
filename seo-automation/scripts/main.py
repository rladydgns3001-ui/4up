"""
SEO/AEO/GEO 자동화 포스팅 파이프라인 — 메인 오케스트레이터

Usage:
    python scripts/main.py              # 실제 발행
    python scripts/main.py --dry-run    # 테스트 (발행 안 함)
"""
import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

from scripts.crawl_top_results import crawl_keyword
from scripts.generate_post import generate_post, POST_TYPES, POST_TYPE_LABELS
from scripts.wordpress_publish import publish_post
from scripts.google_indexing import request_indexing, notify_telegram

# .env 로드
load_dotenv(Path(__file__).parent.parent / ".env")

KEYWORDS = [
    "네이버 블로그 자동화 프로그램",
    "네이버 자동화 프로그램",
    "워드프레스 자동화 블로그",
    "네이버 자동화 블로그",
    "네이버 자동화 블로그 플",
    "네이버 블로그 자동화",
    "블로그 자동화 애드포스트",
    "네이버 블로그 AI 자동화",
    "블로그 자동 발행 프로그램",
    "네이버 자동화 저품질",
]

LOGS_DIR = Path(__file__).parent.parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)


def get_today_config() -> tuple[str, str]:
    """날짜 기반 키워드/포스트 타입 자동 로테이션"""
    day_of_year = datetime.now().timetuple().tm_yday
    keyword = KEYWORDS[day_of_year % len(KEYWORDS)]
    post_type = POST_TYPES[day_of_year % len(POST_TYPES)]
    return keyword, post_type


def run_pipeline(dry_run: bool = False):
    """전체 파이프라인 실행"""
    keyword, post_type = get_today_config()
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = LOGS_DIR / f"{today}.json"

    print(f"{'='*60}")
    print(f"  SEO/AEO/GEO 자동화 파이프라인")
    print(f"  날짜: {today}")
    print(f"  키워드: {keyword}")
    print(f"  포스팅 타입: {POST_TYPE_LABELS[post_type]}")
    print(f"  모드: {'DRY-RUN' if dry_run else 'PRODUCTION'}")
    print(f"{'='*60}\n")

    log = {
        "date": today,
        "keyword": keyword,
        "post_type": post_type,
        "dry_run": dry_run,
        "steps": {},
    }

    # Step 1: 크롤링
    print("[1/4] 구글 상위 결과 크롤링...")
    try:
        crawled = crawl_keyword(keyword)
        log["steps"]["crawl"] = {
            "success": True,
            "results_count": len(crawled.get("results", [])),
        }
    except Exception as e:
        print(f"  [ERROR] Crawl failed: {e}")
        crawled = {"results": []}
        log["steps"]["crawl"] = {"success": False, "error": str(e)}

    # Step 2: 포스트 생성
    print(f"\n[2/4] AI 포스트 생성 ({POST_TYPE_LABELS[post_type]})...")
    try:
        if dry_run and not os.environ.get("ANTHROPIC_API_KEY"):
            # dry-run에서 API 키 없으면 더미 데이터
            post = {
                "title": f"[DRY-RUN] {keyword} {POST_TYPE_LABELS[post_type]}",
                "content": "<h2>테스트</h2><p>Dry-run 테스트 포스트입니다.</p>",
                "excerpt": "테스트",
                "tags": ["테스트"],
                "meta_description": "테스트 메타 설명",
                "keyword": keyword,
                "post_type": post_type,
                "faq_schema": "",
            }
            print("  [DRY-RUN] Using dummy post data (no API key)")
        else:
            post = generate_post(keyword, crawled, post_type)
        log["steps"]["generate"] = {
            "success": True,
            "title": post["title"],
        }
    except Exception as e:
        print(f"  [ERROR] Generation failed: {e}")
        log["steps"]["generate"] = {"success": False, "error": str(e)}
        _save_log(log, log_file)
        _notify_failure(log)
        return log

    # Step 3: WordPress 발행
    print("\n[3/4] WordPress 발행...")
    try:
        if dry_run and not os.environ.get("WP_URL"):
            wp_result = {"success": True, "dry_run": True, "title": post["title"]}
            print("  [DRY-RUN] Would publish to WordPress")
        else:
            wp_result = publish_post(post, dry_run=dry_run)
        log["steps"]["publish"] = wp_result
    except Exception as e:
        print(f"  [ERROR] Publish failed: {e}")
        log["steps"]["publish"] = {"success": False, "error": str(e)}

    # Step 4: Google 인덱싱
    post_url = log["steps"].get("publish", {}).get("url", "")
    print("\n[4/4] Google 인덱싱 요청...")
    if post_url and not dry_run:
        index_result = request_indexing(post_url)
    else:
        index_result = {"success": True, "dry_run": True, "url": post_url or "N/A"}
        print("  [SKIP] No URL to index" if not post_url else "  [DRY-RUN] Skipping indexing")
    log["steps"]["indexing"] = index_result

    # 결과 저장 및 알림
    _save_log(log, log_file)

    # 결과 요약
    print(f"\n{'='*60}")
    print(f"  결과 요약")
    print(f"  크롤링: {'성공' if log['steps'].get('crawl', {}).get('success') else '실패'}")
    print(f"  포스트 생성: {'성공' if log['steps'].get('generate', {}).get('success') else '실패'}")
    print(f"  WordPress 발행: {'성공' if log['steps'].get('publish', {}).get('success') else '실패'}")
    print(f"  인덱싱: {'성공' if log['steps'].get('indexing', {}).get('success') else '실패/스킵'}")
    if post_url:
        print(f"  URL: {post_url}")
    print(f"  로그: {log_file}")
    print(f"{'='*60}")

    # 텔레그램 알림
    if not dry_run:
        publish_result = log["steps"].get("publish", {})
        if publish_result.get("success"):
            notify_telegram(
                f"✅ <b>블로그 발행 완료</b>\n"
                f"제목: {post['title']}\n"
                f"키워드: {keyword}\n"
                f"URL: {post_url}"
            )
        else:
            _notify_failure(log)

    return log


def _save_log(log: dict, log_file: Path):
    """로그 저장"""
    log_file.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  [LOG] Saved to {log_file}")


def _notify_failure(log: dict):
    """실패 알림"""
    errors = []
    for step, data in log.get("steps", {}).items():
        if isinstance(data, dict) and not data.get("success"):
            errors.append(f"{step}: {data.get('error', 'unknown')}")
    if errors:
        notify_telegram(
            f"❌ <b>블로그 발행 실패</b>\n"
            f"키워드: {log.get('keyword', '')}\n"
            f"에러: {chr(10).join(errors)}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SEO/AEO/GEO 자동화 포스팅")
    parser.add_argument("--dry-run", action="store_true", help="테스트 모드 (발행 안 함)")
    args = parser.parse_args()

    result = run_pipeline(dry_run=args.dry_run)
    if not result["steps"].get("generate", {}).get("success"):
        sys.exit(1)
