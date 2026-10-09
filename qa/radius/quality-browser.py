import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path('/private/tmp/infohub-radius-20261002');out.mkdir(exist_ok=True)
token=Path('/private/tmp/infohub-radius-qa/token').read_text().strip()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);ctx=browser.new_context(viewport={'width':1440,'height':1100})
 ctx.add_init_script('localStorage.setItem("infohub_v3_access_token",'+json.dumps(token)+');')
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:58232/radius')
 page.get_by_label('向信息半径提问').fill('AI 教育实践有哪些变化？')
 page.get_by_role('button',name='检索关键词',exact=True).click()
 page.get_by_placeholder('例如：腾讯 或 Hunyuan').fill('scoperadius AI 教育 实践')
 page.get_by_label('发布开始',exact=True).fill('2026-09-01');page.get_by_label('发布结束',exact=True).fill('2026-09-30')
 page.get_by_label('回答方式',exact=True).select_option('compare')
 page.get_by_role('button',name='先查资料',exact=True).click()
 preview=page.get_by_role('region',name='问答资料预览');expect(preview).to_contain_text('前一时段');expect(preview).to_contain_text('当前时段');expect(preview).to_contain_text('选用 2 篇')
 page.screenshot(path=str(out/'comparison-preview.png'),full_page=True)
 page.get_by_role('tab',name='浏览与搜索').click();page.get_by_label('搜索关注源全文').fill('scoperadius');page.get_by_role('button',name='搜索',exact=True).click()
 card=page.locator('.radius-article-card').filter(has=page.get_by_role('button',name='验收 unknown',exact=True));expect(card).to_contain_text('发布日未知')
 page.get_by_role('button',name='验收 audio',exact=True).click();dialog=page.get_by_role('dialog');expect(dialog).to_contain_text('尚不能据此回答节目内容')
 calls=[]
 def transcribe(route):
  calls.append(route.request.method);route.fulfill(json={'status':'queued','taskId':'synthetic-only','message':'synthetic task'})
 page.route('**/api/items/*/audio-transcribe',transcribe);page.on('dialog',lambda d:d.accept())
 page.get_by_role('button',name='转写这一期',exact=True).click();expect(dialog).to_contain_text('转写任务已提交');assert calls==['POST']
 page.screenshot(path=str(out/'audio-gap-action.png'))
 page.get_by_role('button',name='关闭阅读').click();page.set_viewport_size({'width':390,'height':844})
 page.screenshot(path=str(out/'quality-mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
 (out/'quality-browser.json').write_text(json.dumps({'passed':True,'modelCalls':0,'audioTask':'HTTP stub only','checks':['two periods with strict evidence','missing publication label','manual audio action','mobile no overflow']},ensure_ascii=False,indent=2))
 browser.close()
print('PASS comparison preview, unknown dates, audio action (stub only), mobile')
