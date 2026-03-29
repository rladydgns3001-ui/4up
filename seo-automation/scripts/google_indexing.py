"""
Google Indexing API — URL_UPDATED 요청
실패해도 파이프라인 중단 안 함
"""
import json
import os
import tempfile

import requests


def _get_access_token() -> str | None:
    """서비스 계정 JSON으로 액세스 토큰 발급"""
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request

        sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "")
        if not sa_json:
            print("  [SKIP] GOOGLE_SERVICE_ACCOUNT_JSON not set")
            return None

        # JSON 문자열이면 임시 파일로 저장
        if sa_json.startswith("{"):
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False
            ) as f:
                f.write(sa_json)
                sa_path = f.name
        else:
            sa_path = sa_json

        credentials = service_account.Credentials.from_service_account_file(
            sa_path,
            scopes=["https://www.googleapis.com/auth/indexing"],
        )
        credentials.refresh(Request())
        return credentials.token
    except Exception as e:
        print(f"  [ERROR] Failed to get access token: {e}")
        return None


def request_indexing(url: str, dry_run: bool = False) -> dict:
    """Google Indexing API에 URL_UPDATED 요청"""
    print(f"  [INDEX] Requesting indexing for: {url}")

    if dry_run:
        print(f"  [DRY-RUN] Would request indexing for: {url}")
        return {"success": True, "dry_run": True, "url": url}

    token = _get_access_token()
    if not token:
        return {"success": False, "error": "No access token", "url": url}

    try:
        resp = requests.post(
            "https://indexing.googleapis.com/v3/urlNotifications:publish",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"url": url, "type": "URL_UPDATED"},
            timeout=10,
        )
        resp.raise_for_status()
        result = resp.json()
        print(f"  [INDEXED] {url}")
        return {"success": True, "url": url, "response": result}
    except Exception as e:
        print(f"  [WARN] Indexing failed (non-fatal): {e}")
        return {"success": False, "error": str(e), "url": url}


def notify_telegram(message: str) -> bool:
    """텔레그램 알림 발송"""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        return False

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
            timeout=10,
        )
        return True
    except Exception:
        return False


if __name__ == "__main__":
    result = request_indexing("https://wpauto.kr/test", dry_run=True)
    print(json.dumps(result, ensure_ascii=False, indent=2))
