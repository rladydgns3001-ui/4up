"""
구글 상위 5개 결과 크롤링 → JSON 캐시
"""
import json
import os
import time
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _cache_path(keyword: str) -> Path:
    h = hashlib.md5(keyword.encode()).hexdigest()[:12]
    return CACHE_DIR / f"{h}.json"


def _is_cache_valid(path: Path, hours: int = 24) -> bool:
    if not path.exists():
        return False
    mtime = datetime.fromtimestamp(path.stat().st_mtime)
    return datetime.now() - mtime < timedelta(hours=hours)


def _extract_text(url: str) -> dict | None:
    """URL에서 본문 텍스트, 소제목, 핵심 표현 추출"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # 불필요한 태그 제거
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe"]):
            tag.decompose()

        # 소제목 추출
        headings = []
        for h in soup.find_all(["h1", "h2", "h3"]):
            text = h.get_text(strip=True)
            if text and len(text) > 2:
                headings.append({"tag": h.name, "text": text})

        # 본문 텍스트 추출
        body = soup.find("article") or soup.find("main") or soup.find("body")
        paragraphs = []
        if body:
            for p in body.find_all(["p", "li"]):
                text = p.get_text(strip=True)
                if len(text) > 20:
                    paragraphs.append(text)

        if not paragraphs:
            return None

        return {
            "url": url,
            "headings": headings[:15],
            "paragraphs": paragraphs[:30],
            "full_text": "\n".join(paragraphs[:30])[:3000],
        }
    except Exception as e:
        print(f"  [SKIP] {url}: {e}")
        return None


def _search_google(keyword: str, num_results: int = 5) -> list[str]:
    """구글 검색 결과 URL 추출"""
    query = requests.utils.quote(keyword)
    url = f"https://www.google.com/search?q={query}&hl=ko&gl=kr&num={num_results + 3}"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        urls = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("/url?q="):
                real_url = href.split("/url?q=")[1].split("&")[0]
                if not any(skip in real_url for skip in [
                    "google.com", "youtube.com", "accounts.google",
                    "support.google", "maps.google"
                ]):
                    urls.append(real_url)
                    if len(urls) >= num_results:
                        break
        return urls
    except Exception as e:
        print(f"  [ERROR] Google search failed: {e}")
        return []


def crawl_keyword(keyword: str) -> dict:
    """키워드에 대해 구글 상위 결과 크롤링 (24시간 캐시)"""
    cache = _cache_path(keyword)

    if _is_cache_valid(cache):
        print(f"  [CACHE] '{keyword}' — using cached data")
        return json.loads(cache.read_text(encoding="utf-8"))

    print(f"  [CRAWL] '{keyword}' — searching Google...")
    urls = _search_google(keyword)

    results = []
    for i, url in enumerate(urls):
        print(f"    [{i+1}/{len(urls)}] {url[:80]}...")
        data = _extract_text(url)
        if data:
            results.append(data)
        time.sleep(1)  # 요청 간격

    output = {
        "keyword": keyword,
        "crawled_at": datetime.now().isoformat(),
        "results": results,
    }

    cache.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [DONE] {len(results)} results cached")
    return output


if __name__ == "__main__":
    import sys
    kw = sys.argv[1] if len(sys.argv) > 1 else "네이버 블로그 자동화"
    result = crawl_keyword(kw)
    print(json.dumps(result, ensure_ascii=False, indent=2)[:500])
