#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from playwright.sync_api import sync_playwright


API_URL = os.environ.get("INFOHUB_API_URL", "http://127.0.0.1:3001").rstrip("/")
WEB_URL = os.environ.get("INFOHUB_WEB_URL", "http://127.0.0.1").rstrip("/")
REPORT_DATE = os.environ.get("INFOHUB_REPORT_DATE")
SCREENSHOT_DIR = Path(os.environ.get("INFOHUB_SCREENSHOT_DIR", "/private/tmp"))


def api_json(path: str, token: Optional[str] = None, method: str = "GET", payload: Optional[dict] = None) -> dict:
    body = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{API_URL}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc


def resolve_token() -> str:
    token = os.environ.get("INFOHUB_TOKEN")
    if token:
        return token
    email = os.environ.get("INFOHUB_EMAIL")
    password = os.environ.get("INFOHUB_PASSWORD")
    if not email or not password:
        raise RuntimeError("Set INFOHUB_TOKEN, or set INFOHUB_EMAIL and INFOHUB_PASSWORD.")
    data = api_json("/api/auth/login", method="POST", payload={"email": email, "password": password})
    token = data.get("accessToken")
    if not token:
        raise RuntimeError("Login did not return accessToken.")
    return token


def latest_insight(token: str) -> dict:
    if REPORT_DATE:
        return api_json(f"/api/insights/{REPORT_DATE}", token).get("data") or {}
    listed = api_json("/api/insights?limit=1", token).get("data") or []
    if not listed:
        raise RuntimeError("No daily insight found. Generate a daily report before running this probe.")
    date = listed[0].get("date")
    if not date:
        raise RuntimeError(f"Latest insight is missing date: {listed[0]}")
    return api_json(f"/api/insights/{date}", token).get("data") or {}


def choose_item_ids(insight: dict) -> tuple[str, Optional[str]]:
    snapshot = ((insight.get("payload") or {}).get("snapshot") or {})
    top_items = snapshot.get("topItems") or []
    top_item_id = os.environ.get("INFOHUB_TOP_ITEM_ID") or (top_items[0] or {}).get("id")
    if not top_item_id:
        raise RuntimeError("No top item id found in latest daily report snapshot.")

    noise_item_id = os.environ.get("INFOHUB_NOISE_ITEM_ID")
    if noise_item_id:
        return top_item_id, noise_item_id

    for item in snapshot.get("excludedCandidates") or []:
        if item.get("reason") == "business_noise" and item.get("id"):
            return top_item_id, item["id"]
    return top_item_id, None


def assert_text(page, needles: list[str], label: str) -> None:
    text = page.locator("body").inner_text(timeout=15000)
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise AssertionError(f"{label} missing text: {missing}\nVisible text head:\n{text[:1600]}")


def assert_no_body_overflow(page, label: str) -> None:
    metrics = page.evaluate(
        """() => ({
            width: window.innerWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth
        })"""
    )
    max_width = max(metrics["scrollWidth"], metrics["bodyScrollWidth"])
    if max_width > metrics["clientWidth"] + 16:
        raise AssertionError(f"{label} horizontal overflow: {metrics}")


def assert_mobile_nav_visible(page, label: str) -> None:
    clipped = page.evaluate(
        """() => {
            if (window.innerWidth >= 768) return [];
            return Array.from(document.querySelectorAll('nav a')).map((node) => {
                const rect = node.getBoundingClientRect();
                return {
                    text: (node.textContent || '').trim(),
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                };
            }).filter((item) => (
                item.left < -1 ||
                item.right > window.innerWidth + 1
            ));
        }"""
    )
    if clipped:
        raise AssertionError(f"{label} mobile nav links clipped: {clipped}")


def assert_mobile_sources_card_budget(page, route: str, label: str) -> None:
    if not route.startswith("/sources"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    card_actions = page.get_by_role("button", name="查看 Feed", exact=True).count()
    if card_actions > 24:
        raise AssertionError(f"{label} renders too many mobile source cards: {card_actions}")


def assert_mobile_sources_action_labels(page, route: str, label: str) -> None:
    if not route.startswith("/sources"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    text = page.locator("body").inner_text(timeout=15000)
    required = ["自动抓取", "自动转写", "立即采集", "删除信源"]
    missing = [item for item in required if item not in text]
    if missing:
        raise AssertionError(f"{label} missing visible mobile source action labels: {missing}")


def assert_desktop_sources_table_actions_visible(page, route: str, label: str) -> None:
    if not route.startswith("/sources"):
        return
    is_desktop = page.evaluate("() => window.innerWidth >= 1024")
    if not is_desktop:
        return
    action_names = ["看未读", "策略", "修复"]
    viewport_width = page.evaluate("() => document.documentElement.clientWidth")
    cramped: list[dict] = []
    for action_name in action_names:
        button = page.get_by_role("button", name=action_name, exact=True).first
        box = button.bounding_box()
        if not box:
            raise AssertionError(f"{label} source table action is not visible: {action_name}")
        if box["x"] < 0 or box["x"] + box["width"] > viewport_width:
            cramped.append({"action": action_name, "box": box, "viewportWidth": viewport_width})
    if cramped:
        raise AssertionError(f"{label} source table actions are hidden behind horizontal scroll: {cramped}")


def assert_mobile_filtered_item_budget(page, route: str, label: str) -> None:
    if not route.startswith("/filtered"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    rendered_items = page.evaluate(
        """() => Array.from(document.querySelectorAll('button')).filter((node) => {
            const className = String(node.getAttribute('class') || '');
            return className.includes('w-full') && className.includes('rounded-[22px]');
        }).length"""
    )
    if rendered_items > 24:
        raise AssertionError(f"{label} renders too many mobile filtered items: {rendered_items}")


def assert_mobile_settings_header_action(page, route: str, label: str) -> None:
    if not route.startswith("/settings"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    button = page.get_by_role("button", name="刷新").first
    box = button.bounding_box()
    if not box:
        raise AssertionError(f"{label} refresh button is not visible")
    if box["height"] > 52 or box["width"] < 72:
        raise AssertionError(f"{label} refresh button is cramped: {box}")


def assert_mobile_insights_report_shortcut(page, route: str, label: str) -> None:
    if not route.startswith("/insights"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    button = page.get_by_role("button", name="查看最新日报", exact=True).first
    if button.count() == 0:
        raise AssertionError(f"{label} is missing the mobile latest report shortcut")
    box = button.bounding_box()
    viewport_height = page.evaluate("() => window.innerHeight")
    if not box:
        raise AssertionError(f"{label} latest report shortcut is not visible")
    if box["y"] < 0 or box["y"] + box["height"] > viewport_height:
        raise AssertionError(f"{label} latest report shortcut is outside the first viewport: {box}")
    button.click()
    page.wait_for_timeout(600)
    report_section = page.locator("#daily-report-section").first
    section_box = report_section.bounding_box()
    if not section_box:
        raise AssertionError(f"{label} latest report target is not visible after clicking the shortcut")
    if section_box["y"] > 180:
        raise AssertionError(f"{label} latest report shortcut did not scroll near the report section: {section_box}")
    if page.get_by_text("日报导航").count() == 0:
        raise AssertionError(f"{label} daily report section is missing a local report navigation")
    markdown_button = page.get_by_role("button", name="日报正文", exact=True).first
    if markdown_button.count() == 0:
        raise AssertionError(f"{label} daily report navigation is missing the markdown shortcut")
    markdown_button.click()
    page.wait_for_timeout(200)
    markdown_section = page.locator("#report-markdown-section").first
    markdown_box = markdown_section.bounding_box()
    if not markdown_box:
        raise AssertionError(f"{label} report markdown target is not visible after clicking the navigation")
    if markdown_box["y"] > 220:
        raise AssertionError(f"{label} markdown navigation did not scroll near the report body: {markdown_box}")
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_timeout(100)


def wait_ready(page) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=20000)
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        page.wait_for_timeout(1200)


def visit_and_capture(page, route: str, slug: str, viewport_name: str, needles: list[str]) -> str:
    page.goto(f"{WEB_URL}{route}", wait_until="domcontentloaded", timeout=30000)
    wait_ready(page)
    assert_text(page, needles, f"{viewport_name} {route}")
    assert_no_body_overflow(page, f"{viewport_name} {route}")
    assert_mobile_nav_visible(page, f"{viewport_name} {route}")
    assert_mobile_sources_card_budget(page, route, f"{viewport_name} {route}")
    assert_mobile_sources_action_labels(page, route, f"{viewport_name} {route}")
    assert_desktop_sources_table_actions_visible(page, route, f"{viewport_name} {route}")
    assert_mobile_filtered_item_budget(page, route, f"{viewport_name} {route}")
    assert_mobile_settings_header_action(page, route, f"{viewport_name} {route}")
    assert_mobile_insights_report_shortcut(page, route, f"{viewport_name} {route}")
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    screenshot_path = SCREENSHOT_DIR / f"infohub-front-{slug}-{viewport_name}.png"
    page.screenshot(path=str(screenshot_path), full_page=True)
    return str(screenshot_path)


def main() -> int:
    token = resolve_token()
    insight = latest_insight(token)
    top_item_id, noise_item_id = choose_item_ids(insight)

    sources = api_json("/api/sources?sortBy=quality&limit=5", token)
    if not sources.get("data"):
        raise RuntimeError("Sources API returned empty data.")
    source = sources["data"][0]
    quality = source.get("sourceQuality") or {}
    for key in ("contentReadyRate", "aiReadyRate", "noiseRate", "reportSelectedRate"):
        if key not in quality:
            raise AssertionError(f"sourceQuality missing {key}: {quality}")

    top_detail = api_json(f"/api/items/{top_item_id}", token).get("data") or {}
    top_label = (top_detail.get("dailyReportDiagnostic") or {}).get("label")
    if top_label != "已进入日报":
        raise AssertionError(f"Top item diagnostic mismatch: {top_detail.get('dailyReportDiagnostic')}")

    noise_detail = None
    if noise_item_id:
        noise_detail = api_json(f"/api/items/{noise_item_id}", token).get("data") or {}
        noise_label = (noise_detail.get("dailyReportDiagnostic") or {}).get("label")
        if noise_label != "未入报：泛商业噪声":
            raise AssertionError(f"Noise item diagnostic mismatch: {noise_detail.get('dailyReportDiagnostic')}")

    screenshots: list[str] = []
    console_errors: list[str] = []
    viewports = {
        "desktop": {"width": 1366, "height": 900},
        "mobile": {"width": 390, "height": 844},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for viewport_name, viewport in viewports.items():
            context = browser.new_context(viewport=viewport)
            context.add_init_script(
                f"window.localStorage.setItem('infohub_v3_access_token', {json.dumps(token)});"
            )
            page = context.new_page()
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

            screenshots.append(
                visit_and_capture(
                    page,
                    "/sources",
                    "sources",
                    viewport_name,
                    ["信源管理", "质量底座", "正文率", "噪声率", "日报入选率"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/filtered",
                    "filtered",
                    viewport_name,
                    ["过滤池", "过滤原因", "恢复到主 Feed"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/settings",
                    "settings",
                    viewport_name,
                    ["设置中心", "通用偏好", "自动抓取"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    f"/feed/{top_item_id}",
                    "feed-selected",
                    viewport_name,
                    ["日报解释", "已进入日报", "依据：同日最新日报快照", "内容依据：", "阶段修复", "评分拆解"],
                )
            )
            if noise_item_id:
                screenshots.append(
                    visit_and_capture(
                        page,
                        f"/feed/{noise_item_id}",
                        "feed-noise",
                        viewport_name,
                        ["日报解释", "未入报：泛商业噪声", "依据：同日最新日报快照", "阶段修复"],
                    )
                )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/insights",
                    "insights",
                    viewport_name,
                    ["日报工作流", "预览候选池", "日报档案", "未入报解释", "TOP 入报理由", "最终入报"],
                )
            )
            context.close()
        browser.close()

    noisy_errors = [err for err in console_errors if "favicon" not in err.lower()]
    if noisy_errors:
        raise AssertionError(f"Console errors observed: {noisy_errors[:8]}")

    print(
        json.dumps(
            {
                "status": "pass",
                "screenshots": screenshots,
                "sourceSample": {
                    "id": source.get("id"),
                    "name": source.get("name"),
                    "quality": quality,
                },
                "topItemDiagnostic": top_detail.get("dailyReportDiagnostic"),
                "noiseItemDiagnostic": noise_detail.get("dailyReportDiagnostic") if noise_detail else None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        raise
