#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


WEB_URL = os.environ.get("INFOHUB_WEB_URL", "http://127.0.0.1").rstrip("/")
TOKEN_KEY = "infohub_v3_access_token"
LOGIN_JSON = Path(os.environ.get("INFOHUB_LOGIN_JSON", "/private/tmp/infohub_login.json"))
OUTPUT_DIR = Path(os.environ.get("INFOHUB_SCREENSHOT_DIR", "output/playwright"))


def load_token() -> str:
    token = os.environ.get("INFOHUB_TOKEN")
    if token:
        return token
    if not LOGIN_JSON.exists():
        raise RuntimeError(f"missing token file: {LOGIN_JSON}")
    payload = json.loads(LOGIN_JSON.read_text(encoding="utf-8"))
    token = payload.get("accessToken")
    if not token:
        raise RuntimeError(f"login json missing accessToken: {LOGIN_JSON}")
    return token


def slugify(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: probe_feed_readability.py <feed-url> [<feed-url> ...]", file=sys.stderr)
        return 2

    token = load_token()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1200})
        token_payload = json.dumps([TOKEN_KEY, token], ensure_ascii=False)
        page.add_init_script(
            script=f"""
            (([key, token]) => {{
              window.localStorage.setItem(key, token);
            }})({token_payload});
            """,
        )

        for raw_url in sys.argv[1:]:
            url = raw_url if raw_url.startswith("http") else f"{WEB_URL}{raw_url}"
            page.goto(url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(1500)
            page.get_by_role("button", name="摘要", exact=True).wait_for(timeout=15_000)
            page.get_by_role("button", name="原文", exact=True).click(timeout=15_000)
            page.wait_for_timeout(800)
            text = page.locator("body").inner_text(timeout=15_000)
            screenshot_path = OUTPUT_DIR / f"{slugify(raw_url)}.png"
            page.screenshot(path=str(screenshot_path), full_page=True)
            flags = {
                "has_placeholder": "原文待补抓" in text or "当前仅保留摘要片段" in text,
                "has_translation_error": "translation_truncated_or_empty" in text or "翻译失败" in text,
                "has_readability_article": "可以直接阅读正文" in text or "全文可读" in text,
            }
            print(json.dumps({
                "url": raw_url,
                "screenshot": str(screenshot_path),
                "flags": flags,
                "text_head": text[:1200],
            }, ensure_ascii=False, indent=2))

        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
