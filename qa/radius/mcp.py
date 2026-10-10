import json
import os
from pathlib import Path
import subprocess

root=Path(__file__).resolve().parents[2]
env={**os.environ,'INFOHUB_API_URL':'http://127.0.0.1:58231/api','INFOHUB_TOKEN_FILE':'/private/tmp/infohub-radius-qa/token'}
messages=[
    {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'radius-test','version':'1'}}},
    {'jsonrpc':'2.0','method':'notifications/initialized'},
    {'jsonrpc':'2.0','id':2,'method':'tools/list'},
    {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'radius_search','arguments':{'q':'needleold'}}},
    {'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'radius_read','arguments':{'id':'../../settings'}}},
]
result=subprocess.run(['python3',str(root/'scripts/radius/mcp_server.py')],input='\n'.join(json.dumps(m) for m in messages)+'\n',text=True,capture_output=True,env=env,check=True)
replies=[json.loads(line) for line in result.stdout.splitlines()]
assert len(replies)==4
assert {t['name'] for t in replies[1]['result']['tools']}=={'radius_search','radius_read','radius_topics','radius_sources','radius_status','radius_evidence'}
search=json.loads(replies[2]['result']['content'][0]['text'])
assert search['data']['total']==1
assert replies[3]['result']['isError']
assert Path(env['INFOHUB_TOKEN_FILE']).read_text().strip() not in result.stdout+result.stderr
messages[2:] = [{'jsonrpc':'2.0','id':5,'method':'tools/call','params':{'name':'radius_read','arguments':{'id':search['data']['items'][0]['id']}}}]
read=subprocess.run(['python3',str(root/'scripts/radius/mcp_server.py')],input='\n'.join(json.dumps(m) for m in messages)+'\n',text=True,capture_output=True,env=env,check=True)
assert 'needleold' in read.stdout
print('PASS real stdio MCP initialize/tools/search/read; path traversal rejected; credentials absent from output')
