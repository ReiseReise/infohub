"""Real local page + API + Meilisearch; never uses user's browser profile."""
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path('/private/tmp/infohub-radius-qa')
token = (output / 'token').read_text().strip()
name='浏览器验收主题 '+str(time.time_ns())
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_init_script('localStorage.setItem("infohub_v3_access_token", ' + json.dumps(token) + ');')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:58232/radius')
    expect(page.get_by_role('heading', name='我的信息半径')).to_be_visible()
    expect(page.get_by_text('10,021', exact=True).first).to_be_visible(timeout=15000)
    page.get_by_label('搜索关注源全文').fill('needleold')
    page.get_by_role('button', name='搜索', exact=True).click()
    expect(page.get_by_text('找到 1 篇', exact=False)).to_be_visible()
    expect(page.get_by_text('信息流已过滤', exact=False)).to_be_visible()
    page.get_by_role('button', name='阅读已存文本').click()
    expect(page.get_by_role('dialog')).to_contain_text('needleold')
    page.get_by_role('button', name='关闭阅读').click()
    page.screenshot(path=str(output/'desktop.png'),full_page=True)
    page.get_by_role('button', name='新增主题').click()
    page.get_by_label('主题名称').fill(name)
    page.get_by_label('关键词或短语', exact=False).fill('companion，AI 陪伴')
    page.get_by_role('button', name='保存主题', exact=True).click()
    expect(page.get_by_role('button', name=name, exact=True)).to_be_visible()
    expect(page.get_by_text('主题修改后尚未完成索引更新', exact=False)).to_be_visible()
    page.get_by_role('button', name='编辑', exact=True).click()
    page.get_by_label('主题名称').fill(name+' 已编辑')
    page.get_by_role('button', name='保存主题', exact=True).click()
    expect(page.get_by_role('button', name=name+' 已编辑', exact=True)).to_be_visible()
    page.get_by_role('button', name='归档主题', exact=True).click()
    expect(page.get_by_role('button', name=name+' 已编辑', exact=True)).not_to_be_visible()
    page.get_by_role('button', name='全部内容', exact=True).click()
    page.set_viewport_size({"width":390,"height":844})
    expect(page.get_by_role('heading',name='我的信息半径')).to_be_visible()
    page.screenshot(path=str(output/'mobile.png'),full_page=False)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile horizontal overflow'
    assert not errors, errors
    (output/'browser.json').write_text(json.dumps({"passed":True,"viewports":[1440,390],"pageErrors":errors,"flows":["search","read","create topic","edit topic","archive topic"]},ensure_ascii=False,indent=2))
    browser.close()
print('PASS browser: search, original text, topic create/edit/archive, desktop/mobile, no page errors')
