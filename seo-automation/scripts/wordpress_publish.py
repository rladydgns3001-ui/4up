"""
WordPress REST API로 포스트 발행
- 중복 제목 체크
- Yoast SEO 메타 필드 업데이트
- 실패 시 draft 저장
"""
import json
import os

import requests


def _get_wp_auth():
    url = os.environ.get("WP_URL", "").rstrip("/")
    user = os.environ.get("WP_USER", "")
    password = os.environ.get("WP_APP_PASSWORD", "")
    if not all([url, user, password]):
        raise ValueError("WP_URL, WP_USER, WP_APP_PASSWORD 환경변수가 필요합니다")
    return url, user, password


def _check_duplicate(title: str, url: str, auth: tuple) -> bool:
    """중복 제목 체크"""
    try:
        resp = requests.get(
            f"{url}/wp-json/wp/v2/posts",
            params={"search": title, "per_page": 5},
            auth=auth,
            timeout=10,
        )
        resp.raise_for_status()
        for post in resp.json():
            if post["title"]["rendered"].strip() == title.strip():
                print(f"  [DUPLICATE] '{title}' already exists: {post['link']}")
                return True
    except Exception as e:
        print(f"  [WARN] Duplicate check failed: {e}")
    return False


def _get_or_create_category(name: str, url: str, auth: tuple) -> int | None:
    """카테고리 ID 반환 (없으면 생성)"""
    try:
        resp = requests.get(
            f"{url}/wp-json/wp/v2/categories",
            params={"search": name, "per_page": 5},
            auth=auth,
            timeout=10,
        )
        resp.raise_for_status()
        for cat in resp.json():
            if cat["name"] == name:
                return cat["id"]

        # 생성
        resp = requests.post(
            f"{url}/wp-json/wp/v2/categories",
            json={"name": name},
            auth=auth,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()["id"]
    except Exception:
        return None


def publish_post(post: dict, dry_run: bool = False) -> dict:
    """WordPress에 포스트 발행"""
    url, user, password = _get_wp_auth()
    auth = (user, password)

    title = post["title"]
    print(f"  [WP] Publishing: {title}")

    # 중복 체크
    if _check_duplicate(title, url, auth):
        return {"success": False, "error": "duplicate", "title": title}

    if dry_run:
        print(f"  [DRY-RUN] Would publish: {title}")
        return {"success": True, "dry_run": True, "title": title}

    # 카테고리 설정
    cat_id = _get_or_create_category("블로그 자동화", url, auth)
    categories = [cat_id] if cat_id else []

    # 태그 생성/조회
    tag_ids = []
    for tag_name in post.get("tags", [])[:5]:
        try:
            resp = requests.get(
                f"{url}/wp-json/wp/v2/tags",
                params={"search": tag_name, "per_page": 1},
                auth=auth,
                timeout=10,
            )
            resp.raise_for_status()
            existing = resp.json()
            if existing and existing[0]["name"] == tag_name:
                tag_ids.append(existing[0]["id"])
            else:
                resp = requests.post(
                    f"{url}/wp-json/wp/v2/tags",
                    json={"name": tag_name},
                    auth=auth,
                    timeout=10,
                )
                resp.raise_for_status()
                tag_ids.append(resp.json()["id"])
        except Exception:
            pass

    # 포스트 데이터
    post_data = {
        "title": title,
        "content": post["content"],
        "excerpt": post.get("excerpt", ""),
        "status": "publish",
        "categories": categories,
        "tags": tag_ids,
        "meta": {
            "_yoast_wpseo_metadesc": post.get("meta_description", ""),
            "_yoast_wpseo_focuskw": post.get("keyword", ""),
        },
    }

    try:
        resp = requests.post(
            f"{url}/wp-json/wp/v2/posts",
            json=post_data,
            auth=auth,
            timeout=30,
        )
        resp.raise_for_status()
        result = resp.json()
        post_url = result.get("link", "")
        print(f"  [PUBLISHED] {post_url}")
        return {
            "success": True,
            "post_id": result["id"],
            "url": post_url,
            "title": title,
        }
    except Exception as e:
        print(f"  [ERROR] Publish failed: {e}")
        # draft로 저장 시도
        try:
            post_data["status"] = "draft"
            resp = requests.post(
                f"{url}/wp-json/wp/v2/posts",
                json=post_data,
                auth=auth,
                timeout=30,
            )
            resp.raise_for_status()
            result = resp.json()
            print(f"  [DRAFT] Saved as draft: ID {result['id']}")
            return {
                "success": False,
                "draft_id": result["id"],
                "error": str(e),
                "title": title,
            }
        except Exception as e2:
            return {"success": False, "error": str(e2), "title": title}


if __name__ == "__main__":
    test_post = {
        "title": "[테스트] 네이버 블로그 자동화 가이드",
        "content": "<h2>테스트</h2><p>이것은 테스트 포스트입니다.</p>",
        "excerpt": "테스트 포스트",
        "tags": ["테스트"],
        "meta_description": "테스트",
        "keyword": "네이버 블로그 자동화",
    }
    result = publish_post(test_post, dry_run=True)
    print(json.dumps(result, ensure_ascii=False, indent=2))
