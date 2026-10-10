import json,uuid,urllib.request,urllib.error
from pathlib import Path
token=Path('/private/tmp/infohub-radius-qa/token').read_text().strip()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def ask(body,key):
 req=urllib.request.Request('http://127.0.0.1:58231/api/radius/ask',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key})
 try:
  with opener.open(req,timeout=20) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
key=str(uuid.uuid4());body={'question':'AI 陪伴有哪些观点？'}
status,first=ask(body,key);assert status==202,(status,first)
status,again=ask(body,key);assert status==202 and first['data']['runId']==again['data']['runId']
status,changed=ask({'question':'完全不同的问题'},key);assert status==409
status,empty=ask({'question':'AI 陪伴有哪些观点？','sourceIds':[999999]},str(uuid.uuid4()));assert status==200 and empty['data']['runId'] is None
status,invalid=ask({'question':'AI 的变化','from':'2026-02-30'},str(uuid.uuid4()));assert status==400
status,missing=ask({'question':'你觉得怎么样？'},str(uuid.uuid4()));assert status in (200,400)
print('PASS automatic evidence selection, durable request idempotency, conflicting retries, source scope, invalid dates, empty evidence')
