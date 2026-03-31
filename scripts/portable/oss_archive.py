#!/usr/bin/env python3
"""Upload portable backups to OSS and prune remote history."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import oss2


@dataclass
class ArchiveResult:
    bucket: str
    endpoint: str
    object_key: str
    uploaded_at: str
    pruned_keys: list[str]
    retention: int


def require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"missing required env: {name}")
    return value


def build_bucket() -> tuple[oss2.Bucket, str, str]:
    access_key = require_env("OSS_ACCESS_KEY_ID")
    access_secret = require_env("OSS_ACCESS_KEY_SECRET")
    endpoint = (os.getenv("OSS_ENDPOINT") or "https://oss-cn-beijing.aliyuncs.com").strip()
    bucket_name = require_env("BACKUP_OSS_BUCKET")
    auth = oss2.Auth(access_key, access_secret)
    bucket = oss2.Bucket(auth, endpoint, bucket_name)
    return bucket, bucket_name, endpoint


def normalize_prefix(raw_prefix: str) -> str:
    prefix = raw_prefix.strip().strip("/")
    return f"{prefix}/" if prefix else ""


def main() -> int:
    if len(sys.argv) < 2:
      raise RuntimeError("usage: oss_archive.py <backup_file>")

    backup_file = Path(sys.argv[1]).expanduser().resolve()
    if not backup_file.is_file():
        raise RuntimeError(f"backup file not found: {backup_file}")

    retention = max(int((os.getenv("BACKUP_OSS_RETENTION") or "30").strip() or "30"), 1)
    prefix = normalize_prefix(os.getenv("BACKUP_OSS_PREFIX") or "infohub-v3/")
    object_key = f"{prefix}{backup_file.name}"

    bucket, bucket_name, endpoint = build_bucket()

    bucket.put_object_from_file(
        object_key,
        str(backup_file),
        headers={"Content-Type": "application/gzip"},
    )

    summaries = list(oss2.ObjectIterator(bucket, prefix=prefix))
    summaries.sort(key=lambda item: item.last_modified, reverse=True)
    pruned: list[str] = []
    for stale in summaries[retention:]:
        bucket.delete_object(stale.key)
        pruned.append(stale.key)

    result = ArchiveResult(
        bucket=bucket_name,
        endpoint=endpoint,
        object_key=object_key,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        pruned_keys=pruned,
        retention=retention,
    )
    print(json.dumps(asdict(result), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - shell entrypoint
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
