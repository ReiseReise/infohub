"""Executed in audio-service via stdin; read-only model lookup, no service routes."""
import asyncio
import json
import logging
import sys


async def main(request):
    import asyncpg
    import httpx
    from app.config import settings
    from app.services.crypto_service import decrypt_api_key
    logging.disable(logging.CRITICAL)
    connection = await asyncpg.connect(settings.database_url.replace('+asyncpg', ''))
    try:
        async with connection.transaction(readonly=True):
            records = await connection.fetch("""
              SELECT DISTINCT m.id::text AS id,m.model_name,m.provider,m.base_url,m.api_key_encrypted
              FROM public.model_configs m JOIN hub.ai_configs a ON a.model_config_id=m.id::text
              WHERE a.type='scoring' AND a.is_active AND m.is_active
                AND m.provider='dashscope' AND m.extra_config->>'role'='preferred'
            """)
    finally:
        await connection.close()
    if len(records) != 1:
        raise ValueError('ambiguous_current_baseline')
    config = dict(records[0])
    # Restrict this experiment to the inspected current default, never silently switch providers.
    if config['model_name'] != 'dashscope/qwen-plus' or config['base_url']:
        raise ValueError('baseline_configuration_changed')
    identity = {'model': config['model_name'], 'model_config_id': config['id'],
                'endpoint': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                'has_credential': bool(config['api_key_encrypted'])}
    if request['mode'] == 'probe':
        return identity
    if request.get('expected_config_id') != config['id']:
        raise ValueError('baseline_identity_changed')
    if not identity['has_credential']:
        raise ValueError('missing_baseline_credential')
    key = decrypt_api_key(config['api_key_encrypted'])
    # No default credential fallback. Key exists only in this process's memory.
    payload = {'model': 'qwen-plus', 'messages': [{'role': 'user', 'content': request['prompt']}],
               'temperature': 0, 'max_tokens': 1200, 'enable_thinking': False,
               'response_format': {'type': 'json_object'}}
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.post(identity['endpoint'], json=payload,
                                     headers={'Authorization': 'Bearer ' + key})
    if response.status_code != 200:
        return {'error_type': 'upstream_http', 'http_status': response.status_code}
    data = response.json()
    return {'model': data.get('model'), 'text': data['choices'][0]['message']['content'],
            'finish_reason': data['choices'][0].get('finish_reason'), 'usage': data.get('usage', {}),
            'provider_request_id': data.get('id')}


if __name__ == '__main__':
    try:
        result = asyncio.run(main(json.load(sys.stdin)))
    except Exception as error:
        result = {'error_type': type(error).__name__}  # Never return raw exception text.
    print(json.dumps(result, ensure_ascii=False))
