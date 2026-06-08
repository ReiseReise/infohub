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
    problems = page.evaluate(
        """() => {
            if (window.innerWidth >= 768) return [];
            return Array.from(document.querySelectorAll('nav a')).map((node) => {
                const rect = node.getBoundingClientRect();
                const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                return {
                    text,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                    missingLabel: !text,
                    clippedX: rect.left < -1 || rect.right > window.innerWidth + 1,
                    tooSmall: rect.width < 36 || rect.height < 36,
                };
            }).filter((item) => (
                item.missingLabel ||
                item.clippedX ||
                item.tooSmall
            ));
        }"""
    )
    if problems:
        raise AssertionError(f"{label} mobile nav links are clipped, unlabeled, or too small: {problems}")


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


def assert_mobile_sources_governance_controls_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/sources"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    control_problems = page.evaluate(
        """() => {
            const requiredLabels = new Set([
                '搜索',
                'RSS URL',
                'RSSHub 路由',
                '全部视图',
                '高价值信源',
                '网页监控',
                '待修复',
                '表格全览',
                '卡片详情',
                '打开过滤策略',
                '认知升级',
                '技术能力',
                '商业判断',
                '表达输出',
                '打开原文',
                '查看该来源的阅读流',
                '批量重试正文、质检、评分、摘要和翻译',
            ]);
            return Array.from(document.querySelectorAll('button, a[href]')).filter((node) => !node.closest('nav')).map((node) => {
                const rect = node.getBoundingClientRect();
                const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                const label = node.getAttribute('aria-label') || node.getAttribute('title') || text;
                return {
                    label,
                    text,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            }).filter((item) => item.visible && requiredLabels.has(item.label) && (!item.label || item.width < 36 || item.height < 36)).slice(0, 24);
        }"""
    )
    if control_problems:
        raise AssertionError(f"{label} source governance controls are too small, missing, or unlabeled on mobile: {control_problems}")


def assert_mobile_sources_add_form_growth_axes_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/sources"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return

    add_button = page.get_by_role("button", name="添加信源", exact=True).first
    if add_button.count() == 0:
        raise AssertionError(f"{label} sources page is missing add-source action")
    add_button.click()
    page.wait_for_timeout(200)

    control_problems = page.evaluate(
        """() => {
            const labels = new Set(['认知升级', '技术能力', '商业判断', '表达输出']);
            return Array.from(document.querySelectorAll('button')).map((node) => {
                const rect = node.getBoundingClientRect();
                const label = node.getAttribute('aria-label') || node.getAttribute('title') || (node.textContent || '').trim().replace(/\\s+/g, ' ');
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            }).filter((item) => item.visible && labels.has(item.label) && (!item.label || item.width < 36 || item.height < 36));
        }"""
    )
    close_button = page.get_by_role("button", name="取消", exact=True).first
    if close_button.count() > 0:
        close_button.click()
        page.wait_for_timeout(100)
    if control_problems:
        raise AssertionError(f"{label} add-source growth axis controls are too small, missing, or unlabeled on mobile: {control_problems}")


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


def assert_mobile_feed_preview_copy_clean(page, route: str, label: str) -> None:
    if not route.startswith("/feed"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    noisy_previews = page.evaluate(
        """() => Array.from(document.querySelectorAll('p')).map((node) => {
            const text = (node.textContent || '').trim();
            return {
                text,
                hasRepeatedArrow: /(?:->\\s*){4,}|>{8,}|[-_=*]{12,}/.test(text),
                hasModelBoilerplate: /您提供的.*摘要内容为空|请补充需要改写的摘要文本|作为(?:一个)?AI|As an AI language model/i.test(text),
            };
        }).filter((item) => item.text && (item.hasRepeatedArrow || item.hasModelBoilerplate)).slice(0, 5)"""
    )
    if noisy_previews:
        raise AssertionError(f"{label} feed preview exposes raw noise or model boilerplate: {noisy_previews}")


def assert_mobile_feed_filter_controls_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/feed"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    cramped_controls = page.evaluate(
        """() => {
            const requiredMatchers = [
                /^全部$/,
                /^未读(?:\\s*\\(\\d+\\))?$/,
                /^收藏$/,
                /^按时间$/,
                /^按优先级$/,
            ];
            const optionalMatchers = [/^立即补抓到期来源$/];
            const buttons = Array.from(document.querySelectorAll('button')).map((node) => {
                const rect = node.getBoundingClientRect();
                const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                return {
                    label: text,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                };
            });
            const problems = [];
            for (const matcher of requiredMatchers) {
                const matched = buttons.filter((button) => matcher.test(button.label));
                if (!matched.length) {
                    problems.push({ error: 'missing-feed-filter-control', matcher: String(matcher) });
                    continue;
                }
                for (const button of matched) {
                    if (button.width < 36 || button.height < 36) problems.push(button);
                }
            }
            for (const matcher of optionalMatchers) {
                for (const button of buttons.filter((entry) => matcher.test(entry.label))) {
                    if (button.width < 36 || button.height < 36) problems.push(button);
                }
            }
            return problems;
        }"""
    )
    if cramped_controls:
        raise AssertionError(f"{label} feed filter controls are too small or missing on mobile: {cramped_controls}")


def assert_mobile_feed_source_filter_buttons_touchable(page, route: str, label: str) -> None:
    if route != "/feed":
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    cramped_buttons = page.evaluate(
        """() => Array.from(document.querySelectorAll('button')).filter((node) => {
            const className = String(node.getAttribute('class') || '');
            return className.includes('max-w-[180px]') && className.includes('uppercase');
        }).map((node) => {
            const rect = node.getBoundingClientRect();
            const label = (
                node.getAttribute('aria-label') ||
                node.getAttribute('title') ||
                (node.textContent || '').trim().replace(/\\s+/g, ' ')
            );
            return {
                label,
                width: rect.width,
                height: rect.height,
                x: rect.x,
                y: rect.y,
            };
        }).filter((item) => !item.label || item.width < 36 || item.height < 36).slice(0, 8)"""
    )
    if cramped_buttons:
        raise AssertionError(f"{label} feed source filter buttons are too small or unlabeled on mobile: {cramped_buttons}")


def assert_mobile_feed_list_actions_discoverable(page, route: str, label: str) -> None:
    if not route.startswith("/feed"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    hidden_or_unlabeled_actions = page.evaluate(
        """() => Array.from(document.querySelectorAll('div')).filter((node) => {
            const className = String(node.getAttribute('class') || '');
            return className.includes('group-hover:opacity-100') && node.querySelector('button, a');
        }).slice(0, 3).flatMap((container, index) => {
            return Array.from(container.querySelectorAll('button, a')).map((node) => {
                let effectiveOpacity = 1;
                let current = node;
                while (current && current.nodeType === Node.ELEMENT_NODE) {
                    effectiveOpacity *= Number(window.getComputedStyle(current).opacity || 1);
                    if (current === container.parentElement) break;
                    current = current.parentElement;
                }
                const rect = node.getBoundingClientRect();
                const label = [
                    node.getAttribute('aria-label'),
                    node.getAttribute('title'),
                    (node.textContent || '').trim(),
                ].filter(Boolean).join(' ');
                return {
                    index,
                    label,
                    effectiveOpacity,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    tag: node.tagName,
                };
            });
        }).filter((item) => item.effectiveOpacity < 0.95 || !item.label || item.width < 32 || item.height < 32)"""
    )
    if hidden_or_unlabeled_actions:
        raise AssertionError(f"{label} feed list actions are hidden, unlabeled, or too small on mobile: {hidden_or_unlabeled_actions}")


def assert_mobile_feed_detail_has_return_to_list(page, route: str, label: str) -> None:
    if not route.startswith("/feed/"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    button = page.get_by_role("button", name="返回列表", exact=True).first
    if button.count() == 0:
        raise AssertionError(f"{label} feed detail is missing a return-to-list action")
    box = button.bounding_box()
    viewport_height = page.evaluate("() => window.innerHeight")
    if not box or box["y"] < 0 or box["y"] > viewport_height:
        raise AssertionError(f"{label} return-to-list action is not visible near the detail header: {box}")
    button.click()
    page.wait_for_timeout(200)
    list_box = page.locator("#feed-list-panel").first.bounding_box()
    if not list_box:
        raise AssertionError(f"{label} return-to-list target is missing")
    if list_box["y"] > 220:
        raise AssertionError(f"{label} return-to-list action did not scroll near the list panel: {list_box}")


def assert_mobile_feed_detail_header_actions_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/feed/"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    cramped_actions = page.evaluate(
        """() => {
            const header = document.querySelector('[data-feed-detail-header]') || document.querySelector('.sticky');
            if (!header) return [{ error: 'missing-detail-header' }];
            const requiredLabels = ['原文', '重跑AI', '补抓正文'];
            const viewportHeight = window.innerHeight;
            return requiredLabels.map((actionLabel) => {
                const node = Array.from(header.querySelectorAll('button, a')).find((candidate) => {
                    const text = (candidate.textContent || '').replace(/\\s+/g, '');
                    return text.includes(actionLabel);
                });
                if (!node) return { label: actionLabel, error: 'missing-action' };
                const rect = node.getBoundingClientRect();
                const accessibleLabel = [
                    node.getAttribute('aria-label'),
                    node.getAttribute('title'),
                    (node.textContent || '').trim(),
                ].filter(Boolean).join(' ');
                return {
                    label: actionLabel,
                    accessibleLabel,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    outsideViewport: rect.y < 0 || rect.y > viewportHeight,
                };
            }).filter((item) => item.error || item.outsideViewport || !item.accessibleLabel || item.height < 36 || item.width < 36);
        }"""
    )
    if cramped_actions:
        raise AssertionError(f"{label} feed detail header actions are too small or unlabeled on mobile: {cramped_actions}")


def assert_mobile_feed_stage_repair_actions_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/feed/"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    stage_heading = page.get_by_text("阶段修复", exact=True).first
    if stage_heading.count() == 0:
        raise AssertionError(f"{label} feed detail is missing the stage repair section")
    stage_heading.scroll_into_view_if_needed()
    page.wait_for_timeout(100)
    cramped_actions = page.evaluate(
        """() => {
            const section = document.querySelector('[data-feed-stage-repair]') || (() => {
                const heading = Array.from(document.querySelectorAll('*')).find((node) => (node.textContent || '').trim() === '阶段修复');
                return heading?.closest('.rounded-2xl') || null;
            })();
            if (!section) return [{ error: 'missing-stage-repair-section' }];
            const buttons = Array.from(section.querySelectorAll('button'));
            if (!buttons.length) return [{ error: 'missing-stage-repair-actions' }];
            return buttons.map((node) => {
                const rect = node.getBoundingClientRect();
                const accessibleLabel = [
                    node.getAttribute('aria-label'),
                    node.getAttribute('title'),
                    (node.textContent || '').trim(),
                ].filter(Boolean).join(' ');
                return {
                    label: (node.textContent || '').trim().replace(/\\s+/g, ' '),
                    accessibleLabel,
                    width: rect.width,
                    height: rect.height,
                    disabled: Boolean(node.disabled),
                };
            }).filter((item) => item.error || !item.accessibleLabel || item.height < 36 || item.width < 36);
        }"""
    )
    if cramped_actions:
        raise AssertionError(f"{label} feed stage repair actions are too small or unlabeled on mobile: {cramped_actions}")


def assert_mobile_feed_feedback_actions_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/feed/"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    feedback_heading = page.get_by_text("人类反馈", exact=True).first
    if feedback_heading.count() == 0:
        raise AssertionError(f"{label} feed detail is missing the human feedback section")
    feedback_heading.scroll_into_view_if_needed()
    page.wait_for_timeout(100)
    cramped_actions = page.evaluate(
        """() => {
            const section = document.querySelector('[data-feed-feedback]') || (() => {
                const heading = Array.from(document.querySelectorAll('*')).find((node) => (node.textContent || '').trim() === '人类反馈');
                return heading?.closest('.rounded-2xl') || null;
            })();
            if (!section) return [{ error: 'missing-feedback-section' }];
            const buttons = Array.from(section.querySelectorAll('button'));
            if (!buttons.length) return [{ error: 'missing-feedback-actions' }];
            return buttons.map((node) => {
                const rect = node.getBoundingClientRect();
                const labelText = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                const accessibleLabel = [
                    node.getAttribute('aria-label'),
                    node.getAttribute('title'),
                    labelText,
                ].filter(Boolean).join(' ');
                return {
                    label: labelText,
                    accessibleLabel,
                    width: rect.width,
                    height: rect.height,
                    disabled: Boolean(node.disabled),
                };
            }).filter((item) => item.error || !item.accessibleLabel || item.height < 36 || item.width < 36);
        }"""
    )
    if cramped_actions:
        raise AssertionError(f"{label} feed feedback actions are too small or unlabeled on mobile: {cramped_actions}")


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


def assert_mobile_settings_tabs_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/settings"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    cramped_tabs = page.evaluate(
        """() => {
            const requiredLabels = ['通用偏好', '阅读 AI', 'AI 管理中心', '集成', '诊断中心', '播客配额', '管理后台'];
            const buttons = Array.from(document.querySelectorAll('button')).map((node) => {
                const rect = node.getBoundingClientRect();
                const label = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                };
            });
            return requiredLabels.flatMap((requiredLabel) => {
                const matched = buttons.filter((button) => button.label === requiredLabel);
                if (!matched.length) return [{ error: 'missing-settings-tab', label: requiredLabel }];
                return matched.filter((button) => button.width < 36 || button.height < 36);
            });
        }"""
    )
    if cramped_tabs:
        raise AssertionError(f"{label} settings tabs are too small or missing on mobile: {cramped_tabs}")


def assert_mobile_settings_secondary_controls_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/settings"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return

    problems: list[dict] = []

    def collect_exact_buttons(stage: str, required_labels: list[str]) -> None:
        stage_problems = page.evaluate(
            """({ stage, requiredLabels }) => {
                const buttons = Array.from(document.querySelectorAll('button')).map((node) => {
                    const rect = node.getBoundingClientRect();
                    const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                    const label = node.getAttribute('aria-label') || node.getAttribute('title') || text;
                    return {
                        stage,
                        label,
                        width: rect.width,
                        height: rect.height,
                        x: rect.x,
                        y: rect.y,
                        visible: rect.width > 0 && rect.height > 0,
                    };
                }).filter((item) => item.visible);
                return requiredLabels.flatMap((requiredLabel) => {
                    const matched = buttons.filter((button) => button.label === requiredLabel);
                    if (!matched.length) return [{ stage, error: 'missing-control', label: requiredLabel }];
                    return matched.filter((button) => button.width < 36 || button.height < 36);
                });
            }""",
            {"stage": stage, "requiredLabels": required_labels},
        )
        problems.extend(stage_problems)

    def collect_present_buttons(stage: str, labels: list[str], require_any: bool = False) -> None:
        stage_problems = page.evaluate(
            """({ stage, labels, requireAny }) => {
                const wanted = new Set(labels);
                const matched = Array.from(document.querySelectorAll('button')).map((node) => {
                    const rect = node.getBoundingClientRect();
                    const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                    const label = node.getAttribute('aria-label') || node.getAttribute('title') || text;
                    return {
                        stage,
                        label,
                        width: rect.width,
                        height: rect.height,
                        x: rect.x,
                        y: rect.y,
                        visible: rect.width > 0 && rect.height > 0,
                    };
                }).filter((item) => item.visible && wanted.has(item.label));
                if (requireAny && !matched.length) return [{ stage, error: 'missing-any-control', labels }];
                return matched.filter((button) => button.width < 36 || button.height < 36);
            }""",
            {"stage": stage, "labels": labels, "requireAny": require_any},
        )
        problems.extend(stage_problems)

    ai_center = page.get_by_role("button", name="AI 管理中心", exact=True).first
    if ai_center.count() == 0:
        raise AssertionError(f"{label} settings page is missing the AI management center tab")
    ai_center.click()
    page.wait_for_timeout(200)
    collect_exact_buttons("AI 管理中心", ["场景控制台", "模型仓库", "评分 Skills", "使用日志"])
    collect_exact_buttons("提示词模板库", ["编辑", "预览"])

    model_tab = page.get_by_role("button", name="模型仓库", exact=True).first
    if model_tab.count() > 0:
        model_tab.click()
        page.wait_for_timeout(200)
        if page.get_by_text("Base URL：").count() > 0:
            collect_exact_buttons("模型仓库", ["编辑", "测试", "删除"])

    admin_tab = page.get_by_role("button", name="管理后台", exact=True).first
    if admin_tab.count() > 0:
        admin_tab.click()
        page.wait_for_timeout(200)
        collect_exact_buttons("管理后台", ["总览看板", "任务管理", "用户管理", "邀请码管理"])
        tasks_tab = page.get_by_role("button", name="任务管理", exact=True).first
        if tasks_tab.count() > 0:
            tasks_tab.click()
            page.wait_for_timeout(200)
            if page.get_by_text("共 ", exact=False).count() > 0:
                collect_exact_buttons("任务管理", ["搜索", "重跑"])
        users_tab = page.get_by_role("button", name="用户管理", exact=True).first
        if users_tab.count() > 0:
            users_tab.click()
            page.wait_for_timeout(200)
            if page.get_by_text("role:", exact=False).count() > 0:
                collect_present_buttons("用户管理", ["禁用", "启用"], require_any=True)
                collect_exact_buttons("用户管理", ["切换角色", "删除"])

    if problems:
        raise AssertionError(f"{label} settings secondary controls are too small or missing on mobile: {problems}")


def assert_mobile_settings_diagnostics_copy_clean(page, route: str, label: str) -> None:
    if not route.startswith("/settings"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return

    diagnostics_tab = page.get_by_role("button", name="诊断中心", exact=True).first
    if diagnostics_tab.count() == 0:
        raise AssertionError(f"{label} settings page is missing the diagnostics tab")
    diagnostics_tab.click()
    page.wait_for_timeout(300)

    raw_labels = page.evaluate(
        """() => {
            const sections = Array.from(document.querySelectorAll('*')).filter((node) => {
                const text = (node.textContent || '').trim();
                return text === '抓取队列诊断' || text === '最近抓取结果' || text === '历史裁剪状态' || text === '存储与备份';
            }).map((heading) => heading.closest('.rounded-xl') || heading.parentElement).filter(Boolean);
            if (!sections.length) return [{ error: 'missing-diagnostics-sections' }];
            const rawPatterns = [
                /\\bwaiting\\s*:/i,
                /\\bactive\\s*:/i,
                /\\bcompleted\\s*:/i,
                /\\bfailed\\s*:/i,
                /\\bfound\\s+\\d+/i,
                /\\bnew\\s+\\d+/i,
                /\\bfiltered\\s+\\d+/i,
                /\\bduplicate\\s+\\d+/i,
                /\\bai\\s+\\d+/i,
                /\\bsourceId\\s*:/i,
                /\\battempts\\s*:/i,
                /\\ball_duplicate\\b/i,
                /\\bprioritized\\b/i,
                /模式：\\s*apply/i,
                /状态：\\s*success/i,
                /音频存储\\s+local/i,
                /最近结果：\\s*success/i,
                /\\bbackup_only\\b/i,
                /\\bsync_ok\\b/i,
                /\\barchive_only\\b/i,
                /预计\\/最近删除：\\s*items/i,
                /预计\\/最近删除：.*\\baudio\\b/i,
            ];
            return sections.flatMap((section) => {
                const text = (section.textContent || '').replace(/\\s+/g, ' ').trim();
                return rawPatterns
                    .filter((pattern) => pattern.test(text))
                    .map((pattern) => ({ pattern: String(pattern), text: text.slice(0, 260) }));
            });
        }"""
    )
    if raw_labels:
        raise AssertionError(f"{label} diagnostics copy exposes raw backend labels on mobile: {raw_labels}")


def assert_insights_copy_clean(page, route: str, label: str) -> None:
    if route != "/insights":
        return
    text = page.locator("body").inner_text(timeout=15000)
    raw_patterns = [
        "请您提供待改写的摘要原文",
        "作为 AI",
        "我无法",
    ]
    hits = [pattern for pattern in raw_patterns if pattern in text]
    if hits:
        raise AssertionError(f"{label} insights copy exposes model boilerplate: {hits}")


def assert_desktop_insights_report_reader_sticky(page, route: str, label: str) -> None:
    if route != "/insights":
        return
    is_desktop = page.evaluate("() => window.innerWidth >= 1024")
    if not is_desktop:
        return
    jump_button = page.get_by_role("button", name="查看最新日报", exact=True).first
    if jump_button.count() == 0:
        raise AssertionError(f"{label} insights page is missing latest-report jump")
    jump_button.click()
    page.wait_for_timeout(200)
    problems = page.evaluate(
        """() => {
            const reader = document.querySelector('[data-report-reader]');
            const dateRail = document.querySelector('[data-report-date-rail]');
            const nav = document.querySelector('#report-local-navigation');
            if (!reader || !dateRail || !nav) return [{ error: 'missing-report-reading-surfaces' }];
            const before = {
                reader: reader.getBoundingClientRect(),
                dateRail: dateRail.getBoundingClientRect(),
                nav: nav.getBoundingClientRect(),
                scrollHeight: reader.scrollHeight,
                clientHeight: reader.clientHeight,
            };
            reader.scrollTop = Math.min(1400, Math.max(0, reader.scrollHeight - reader.clientHeight));
            const after = {
                reader: reader.getBoundingClientRect(),
                dateRail: dateRail.getBoundingClientRect(),
                nav: nav.getBoundingClientRect(),
                scrollTop: reader.scrollTop,
                scrollHeight: reader.scrollHeight,
                clientHeight: reader.clientHeight,
            };
            const issues = [];
            if (after.scrollHeight <= after.clientHeight + 24) {
                issues.push({ error: 'report-reader-is-not-scrollable', scrollHeight: after.scrollHeight, clientHeight: after.clientHeight });
            }
            if (after.scrollTop <= 0) {
                issues.push({ error: 'report-reader-did-not-scroll', scrollTop: after.scrollTop });
            }
            if (after.nav.y < after.reader.y - 2 || after.nav.y > after.reader.y + 96) {
                issues.push({ error: 'report-navigation-not-sticky', before, after });
            }
            if (after.dateRail.y < -2 || after.dateRail.y > window.innerHeight) {
                issues.push({ error: 'report-date-rail-not-visible', before, after });
            }
            return issues;
        }"""
    )
    if problems:
        raise AssertionError(f"{label} insights report reader is not stable for long reading: {problems}")


def assert_mobile_monitor_actions_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/monitor"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    action_problems = page.evaluate(
        """() => {
            if (document.body.innerText.includes('暂无网页监控源')) return [];
            const requiredLabels = ['立即抓取', '删除'];
            if (document.body.innerText.includes('去 Feed')) {
                requiredLabels.push('去 Feed', '打开原文');
            }
            const actions = Array.from(document.querySelectorAll('button, a[href]')).filter((node) => !node.closest('nav')).map((node) => {
                const rect = node.getBoundingClientRect();
                const label = (
                    node.getAttribute('aria-label') ||
                    node.getAttribute('title') ||
                    (node.textContent || '').trim().replace(/\\s+/g, ' ')
                );
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight,
                };
            }).filter((action) => action.visible);
            return requiredLabels.flatMap((requiredLabel) => {
                const matched = actions.filter((action) => action.label === requiredLabel);
                if (!matched.length) return [{ error: 'missing-monitor-action', label: requiredLabel }];
                return matched.filter((action) => action.width < 36 || action.height < 36);
            });
        }"""
    )
    if action_problems:
        raise AssertionError(f"{label} monitor actions are too small, missing, or unlabeled on mobile: {action_problems}")


def assert_mobile_rules_strategy_controls_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/rules"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    control_problems = page.evaluate(
        """() => {
            const labels = new Set(['个人层', '全局层', '个人', '全局', '直通', '轻审', '标准', '严审', '哨兵', '只看已有覆盖', '去设置', '查看该源过滤池']);
            return Array.from(document.querySelectorAll('button, a[href]')).filter((node) => !node.closest('nav')).map((node) => {
                const rect = node.getBoundingClientRect();
                const text = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                const label = node.getAttribute('aria-label') || node.getAttribute('title') || text;
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            }).filter((item) => item.visible && labels.has(item.label) && (!item.label || item.width < 36 || item.height < 36)).slice(0, 20);
        }"""
    )
    if control_problems:
        raise AssertionError(f"{label} rules strategy controls are too small, missing, or unlabeled on mobile: {control_problems}")


def assert_mobile_audio_detail_actions_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/audio"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    action_problems = page.evaluate(
        """() => {
            const bodyText = document.body.innerText || '';
            if (bodyText.includes('暂无任务')) return [];
            const requiredLabels = ['重跑', '删除', '概览', '摘要', '转写', 'Markdown', '原始结果'];
            if (bodyText.includes('查看技术详情')) requiredLabels.push('查看技术详情');
            const actions = Array.from(document.querySelectorAll('button')).map((node) => {
                const rect = node.getBoundingClientRect();
                const label = (
                    node.getAttribute('aria-label') ||
                    node.getAttribute('title') ||
                    (node.textContent || '').trim().replace(/\\s+/g, ' ')
                );
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            }).filter((action) => action.visible);
            return requiredLabels.flatMap((requiredLabel) => {
                const matched = actions.filter((action) => action.label === requiredLabel);
                if (!matched.length) return [{ error: 'missing-audio-action', label: requiredLabel }];
                return matched.filter((action) => action.width < 36 || action.height < 36);
            });
        }"""
    )
    if action_problems:
        raise AssertionError(f"{label} audio detail actions are too small, missing, or unlabeled on mobile: {action_problems}")


def assert_report_heading_date_not_split(page, label: str) -> None:
    date_layout = page.evaluate(
        """() => {
            const h1 = document.querySelector('#report-markdown-section h1');
            if (!h1) return { error: 'missing-heading' };
            const text = h1.textContent || '';
            const match = text.match(/\\d{4}-\\d{2}-\\d{2}/);
            if (!match) return { error: 'missing-date', text };

            const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const local = (node.textContent || '').indexOf(match[0]);
                if (local >= 0) {
                    const range = document.createRange();
                    range.setStart(node, local);
                    range.setEnd(node, local + match[0].length);
                    const rects = Array.from(range.getClientRects()).map((rect) => ({
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    }));
                    return { text, date: match[0], rects };
                }
            }
            return { error: 'date-node-missing', text, date: match[0] };
        }"""
    )
    if date_layout.get("error"):
        raise AssertionError(f"{label} report title date probe failed: {date_layout}")
    rects = date_layout.get("rects") or []
    if len(rects) != 1:
        raise AssertionError(f"{label} report title date is split across lines: {date_layout}")


def assert_mobile_insights_mode_controls_touchable(page, route: str, label: str) -> None:
    if not route.startswith("/insights"):
        return
    is_mobile = page.evaluate("() => window.innerWidth < 768")
    if not is_mobile:
        return
    cramped_controls = page.evaluate(
        """() => {
            const requiredLabels = ['快速', '完整'];
            const buttons = Array.from(document.querySelectorAll('button')).map((node) => {
                const rect = node.getBoundingClientRect();
                const label = (node.textContent || '').trim().replace(/\\s+/g, ' ');
                return {
                    label,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x,
                    y: rect.y,
                };
            });
            return requiredLabels.flatMap((requiredLabel) => {
                const matched = buttons.filter((button) => button.label === requiredLabel);
                if (!matched.length) return [{ error: 'missing-insights-mode-control', label: requiredLabel }];
                return matched.filter((button) => button.width < 36 || button.height < 36);
            });
        }"""
    )
    if cramped_controls:
        raise AssertionError(f"{label} insights generation mode controls are too small or missing on mobile: {cramped_controls}")


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
    back_button = page.get_by_role("button", name="返回日报导航", exact=True).first
    if back_button.count() == 0:
        raise AssertionError(f"{label} report body is missing the return-to-navigation control")
    back_box = back_button.bounding_box()
    if not back_box or back_box["y"] < 0 or back_box["y"] > viewport_height:
        raise AssertionError(f"{label} return-to-navigation control is not visible near the report body: {back_box}")
    assert_report_heading_date_not_split(page, label)
    back_button.click()
    page.wait_for_timeout(200)
    nav_box = page.locator("#report-local-navigation").first.bounding_box()
    if not nav_box:
        raise AssertionError(f"{label} report local navigation target is missing after clicking return")
    if nav_box["y"] > 220:
        raise AssertionError(f"{label} return-to-navigation control did not scroll near the report navigation: {nav_box}")
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
    assert_mobile_sources_governance_controls_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_sources_add_form_growth_axes_touchable(page, route, f"{viewport_name} {route}")
    assert_desktop_sources_table_actions_visible(page, route, f"{viewport_name} {route}")
    assert_mobile_filtered_item_budget(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_preview_copy_clean(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_filter_controls_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_source_filter_buttons_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_list_actions_discoverable(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_detail_header_actions_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_detail_has_return_to_list(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_stage_repair_actions_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_feed_feedback_actions_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_settings_header_action(page, route, f"{viewport_name} {route}")
    assert_mobile_settings_tabs_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_settings_secondary_controls_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_settings_diagnostics_copy_clean(page, route, f"{viewport_name} {route}")
    assert_insights_copy_clean(page, route, f"{viewport_name} {route}")
    assert_desktop_insights_report_reader_sticky(page, route, f"{viewport_name} {route}")
    assert_mobile_monitor_actions_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_rules_strategy_controls_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_audio_detail_actions_touchable(page, route, f"{viewport_name} {route}")
    assert_mobile_insights_mode_controls_touchable(page, route, f"{viewport_name} {route}")
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
                    "/monitor",
                    "monitor",
                    viewport_name,
                    ["网页监控", "采集目标管理", "结果 / 变更时间线"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/rules",
                    "rules",
                    viewport_name,
                    ["过滤策略台", "分级质检矩阵", "单源覆盖编辑", "硬规则面板"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/audio",
                    "audio",
                    viewport_name,
                    ["音频工坊", "上传或抓取", "任务"],
                )
            )
            screenshots.append(
                visit_and_capture(
                    page,
                    "/feed",
                    "feed",
                    viewport_name,
                    ["信息流", "全部", "按时间"],
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
