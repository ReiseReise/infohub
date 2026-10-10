#!/usr/bin/env python3
"""Freeze reviewed public article selections. Local files only; no network/DB."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from jev_experiment import save, load_public


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.hidden=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript'):
            self.hidden += 1
        if tag in ('p','div','br','li','h1','h2','h3','tr'):
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript'):
            self.hidden=max(0,self.hidden-1)
        if tag in ('p','div','li','h1','h2','h3','tr'):
            self.parts.append('\n')
    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(body):
    # The hub stores both HTML and Markdown. URLs in Markdown link syntax are
    # markup, not visible article words; remove them consistently before matching.
    body=re.sub(r'\[([^\]]*)\]\([^\n)]*\)',r'\1',body)
    p=Text(); p.feed(body)
    return '\n'.join(' '.join(line.split()) for line in ''.join(p.parts).splitlines() if line.strip())


def compact(text):
    return ''.join(re.findall(r'\w',html.unescape(text).lower()))


def freeze(selection, raw, access, directory, output):
    if output.exists():
        raise ValueError('frozen_dataset_exists')
    raw={r['id']:r for r in raw}; access={r['id']:r for r in access}
    rows=[]; excluded=[]; clusters=set(); dedup=set()
    for meta in selection:
        key=meta['id']; article=raw[key]; check=access[key]
        if check['access']!='public_page_confirmed':
            excluded.append({'id':key,'reason':'public_access_not_confirmed'}); continue
        body=plain(article['body']); normalized=compact(body)
        page=directory/('page-'+key+'.html')
        page_bytes=page.read_bytes()
        raw_page=page_bytes.decode('utf-8')
        if hashlib.sha256(page_bytes).hexdigest()!=check['body_sha256']:
            raise ValueError('page_hash_changed')
        public=compact(plain(raw_page))
        snippets=[normalized[int(len(normalized)*p):int(len(normalized)*p)+60] for p in (.1,.5,.85)]
        matches=sum(len(s)==60 and s in public for s in snippets)
        if matches<3:
            excluded.append({'id':key,'reason':'body_not_matched_to_public_page','matched_samples':matches}); continue
        cluster=article.get('cluster_id'); dedup_hash=article.get('dedup_hash')
        if cluster and cluster in clusters or dedup_hash and dedup_hash in dedup:
            excluded.append({'id':key,'reason':'duplicate_event_or_content'});continue
        if cluster:clusters.add(cluster)
        if dedup_hash:dedup.add(dedup_hash)
        rows.append({'id':key,'kind':'public','language':meta['language'],'category':meta['category'],
                     'title':article['title'],'text':body,'source':meta['source'],'url':meta['url'],
                     'published_at':article['published_at'],
                     'content_sha256':hashlib.sha256(body.encode()).hexdigest(),
                     'event_key':meta['event_key'],
                     'completeness':{'status':'body_present_not_editorially_certified',
                                     'stored_readability_status':article['readability_status'],
                                     'public_body_samples_matched':matches,'truncated':False},
                     'public_access':{'status':'verified','checked_at':check['checked_at'],
                                      'evidence_sha256':check['body_sha256']}})
    temporary=output.with_suffix('.candidate.jsonl')
    temporary.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    temporary.chmod(0o600)
    if rows:load_public(temporary)
    temporary.rename(output)
    manifest={'frozen_at':datetime.now(timezone.utc).isoformat(),'selected':len(rows),'target':30,
              'window':'2026-09-07 through 2026-09-21 Asia/Shanghai; fallback to 2026-08-22 only if needed',
              'strata':dict(Counter(r['category']+'/'+r['language'] for r in rows)),
              'excluded':excluded,'dataset_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
              'limitations':['Purposive exploratory sample, not random or representative',
                'One Jev-related article included; no vendor superiority inference',
                'Categories manually selected; source and event judgments require review',
                'Three body span matches prove accessible overlap, not all factual claims or completeness']}
    save(output.with_suffix('.manifest.json'),manifest)
    return manifest


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--selection',type=Path,required=True);p.add_argument('--raw',type=Path,required=True)
    p.add_argument('--access',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    print(json.dumps(freeze(json.loads(a.selection.read_text()),json.loads(a.raw.read_text()),
        json.loads(a.access.read_text()),a.access.parent,a.output),ensure_ascii=False))
