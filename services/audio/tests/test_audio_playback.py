"""Exercise playback route/storage without importing the DB-seeding application.

The source route and LocalStorage are AST-loaded with synthetic identity/DB
fixtures. ASGI tests send the real Starlette FileResponse and never open sockets.
They skip only when that optional host dependency is unavailable; acceptance
must also run them in the audio-service dependency environment without skips.
"""
from __future__ import annotations

import ast
import hashlib
import os
import re
import tempfile
import unittest
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

try:
    import starlette
    from starlette.requests import Request as StarletteRequest
    from starlette.responses import FileResponse as StarletteFileResponse
    from starlette.responses import RedirectResponse as StarletteRedirectResponse
except ModuleNotFoundError:
    starlette = None
    StarletteRequest = None
    StarletteFileResponse = None
    StarletteRedirectResponse = None

ROOT = Path(os.environ.get("INFOHUB_AUDIO_TEST_ROOT", str(Path(__file__).resolve().parents[1])))
RUN_METRICS = []


def load_source_symbols(relative_path, names, namespace):
    source = ROOT / relative_path
    parsed = ast.parse(source.read_text())
    selected = [node for node in parsed.body
                if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
                and node.name in names]
    if {node.name for node in selected} != set(names):
        raise AssertionError(f"Missing source symbols in {relative_path}")
    for node in selected:
        # Keep method decorators (abstractmethod); strip only router decorators.
        node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
                              *selected], type_ignores=[])
    ast.fix_missing_locations(module)
    exec(compile(module, str(source), "exec"), namespace)
    return namespace


class RouteError(Exception):
    def __init__(self, status_code, detail, headers=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.headers = headers or {}


class Field:
    def __init__(self, name):
        self.name = name

    def __eq__(self, value):
        return self.name, value


class Query:
    def where(self, *criteria):
        self.criteria = dict(criteria)
        return self


class StubFileResponse:
    def __init__(self, path, media_type, stat_result):
        self.path, self.media_type, self.stat_result = path, media_type, stat_result


class StubRedirectResponse:
    def __init__(self, url, status_code):
        self.status_code = status_code
        self.headers = {"location": url}


def scope_for(range_values=()):
    return {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1", "method": "GET", "scheme": "http",
            "path": "/synthetic-audio", "raw_path": b"/synthetic-audio", "query_string": b"",
            "headers": [(b"range", value.encode("ascii")) for value in range_values],
            "client": ("127.0.0.1", 12345), "server": ("fixture.invalid", 80)}


def request_for(range_values=()):
    if StarletteRequest is not None:
        return StarletteRequest(scope_for(range_values))
    return SimpleNamespace(headers=SimpleNamespace(getlist=lambda name: list(range_values) if name == "range" else []))


class PlaybackFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="audio-playback-test-", dir=os.environ.get("INFOHUB_AUDIO_TEST_TMPDIR"))
        self.addCleanup(self.temp.cleanup)
        self.fixture_root = Path(self.temp.name)
        self.uploads = self.fixture_root / "uploads"
        self.uploads.mkdir()
        self.file = self.uploads / "2026" / "synthetic.mp3"
        self.file.parent.mkdir()
        self.content = bytes(range(256)) * 4
        self.file.write_bytes(self.content)
        self.task = SimpleNamespace(
            id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
            user_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
            audio_url="2026/synthetic.mp3", audio_format="mp3")
        storage_namespace = load_source_symbols("app/services/storage_service.py", {"StorageProvider", "LocalStorage"}, {
            "ABC": ABC, "abstractmethod": abstractmethod, "Path": Path, "datetime": datetime,
            "uuid": uuid, "settings": SimpleNamespace(local_storage_path=str(self.uploads)),
        })
        self.local_class = storage_namespace["LocalStorage"]
        self.storage = self.local_class()
        self.storage.download = AsyncMock(side_effect=AssertionError("Playback must not call download"))
        helper_namespace = load_source_symbols("app/services/audio_playback.py", {"is_supported_audio_range"}, {"re": re})
        self.range_guard = helper_namespace["is_supported_audio_range"]
        self.db_reads = []
        fixture = self

        class DB:
            async def execute(self, query):
                fixture.db_reads.append(query.criteria)
                matches = query.criteria == {"id": fixture.task.id, "user_id": fixture.task.user_id}
                return SimpleNamespace(scalar_one_or_none=lambda: fixture.task if matches else None)

        self.db = DB()
        self.payload = {"task_id": str(self.task.id), "sub": str(self.task.user_id)}
        self.storage_selector = Mock(side_effect=lambda _: self.storage)
        self.namespace = {
            "uuid": uuid, "Query": lambda _: "", "Depends": lambda _: None, "get_db": lambda: None,
            "_decode_audio_playback_token": lambda token: self.payload if token == "synthetic-valid" else None,
            "HTTPException": RouteError, "status": SimpleNamespace(HTTP_401_UNAUTHORIZED=401),
            "select": lambda _: Query(), "AudioTask": SimpleNamespace(id=Field("id"), user_id=Field("user_id")),
            "_storage_for_audio_url": self.storage_selector, "_audio_media_type": lambda _: "audio/mpeg",
            "LocalStorage": self.local_class, "is_supported_audio_range": self.range_guard,
            "FileResponse": StarletteFileResponse or StubFileResponse,
            "RedirectResponse": StarletteRedirectResponse or StubRedirectResponse,
            "_is_http_url": lambda value: bool(value and value.startswith(("http://", "https://"))),
            "AUDIO_PLAYBACK_EXPIRES_SECONDS": 7200,
        }
        load_source_symbols("app/api/tasks.py", {"stream_task_audio"}, self.namespace)
        self.route = self.namespace["stream_task_audio"]

    async def call_route(self, ranges=(), token="synthetic-valid", task_id=None):
        return await self.route(task_id or str(self.task.id), request_for(ranges), token, self.db)

    async def assert_route_status(self, expected, **kwargs):
        with self.assertRaises(RouteError) as error:
            await self.call_route(**kwargs)
        self.assertEqual(error.exception.status_code, expected)
        return error.exception


class AudioPlaybackRouteTests(PlaybackFixture, unittest.IsolatedAsyncioTestCase):
    async def test_invalid_token_never_queries_db_or_storage(self):
        await self.assert_route_status(401, token="synthetic-invalid")
        self.assertEqual(self.db_reads, [])
        self.storage_selector.assert_not_called()

    async def test_token_task_mismatch_never_queries_db_or_storage(self):
        self.payload["task_id"] = str(uuid.UUID(int=3))
        await self.assert_route_status(401)
        self.assertEqual(self.db_reads, [])
        self.storage_selector.assert_not_called()

    async def test_malformed_subject_never_queries_db_or_storage(self):
        self.payload["sub"] = "not-a-uuid"
        await self.assert_route_status(401)
        self.assertEqual(self.db_reads, [])
        self.storage_selector.assert_not_called()

    async def test_wrong_owner_is_not_found_and_never_opens_storage(self):
        self.payload["sub"] = str(uuid.UUID(int=4))
        await self.assert_route_status(404)
        self.assertEqual(len(self.db_reads), 1)
        self.storage_selector.assert_not_called()

    async def test_missing_task_audio_is_not_found(self):
        self.task.audio_url = ""
        await self.assert_route_status(404)
        self.storage_selector.assert_not_called()

    async def test_local_file_uses_file_response_without_download_or_read_bytes(self):
        with patch.object(Path, "read_bytes", side_effect=AssertionError("Playback must not buffer file")):
            response = await self.call_route()
        self.assertEqual(Path(response.path), self.file.resolve())
        self.assertEqual(response.media_type, "audio/mpeg")
        self.assertEqual(response.stat_result.st_size, len(self.content))
        self.storage.download.assert_not_awaited()
        self.assertEqual(self.db_reads, [{"id": self.task.id, "user_id": self.task.user_id}])

    async def test_range_guard_rejects_duplicate_multipart_oversized_and_garbage_before_file_response(self):
        many_ranges = "bytes=" + ",".join(f"{number * 3}-{number * 3 + 1}" for number in range(5000))
        cases = [("bytes=0-1", "bytes=3-4"), ("bytes=0-1,3-4",), (many_ranges,),
                 ("bytes=" + "1" * 129 + "-",), ("bytes=0-1junk",), ("bytes=-",)]
        forbidden_response = Mock(side_effect=AssertionError("Unsafe Range reached FileResponse"))
        self.namespace["FileResponse"] = forbidden_response
        for values in cases:
            with self.subTest(header_count=len(values), first_header_length=len(values[0])):
                error = await self.assert_route_status(416, ranges=values)
                self.assertEqual(error.headers["Content-Range"], f"bytes */{len(self.content)}")
        forbidden_response.assert_not_called()
        self.storage.download.assert_not_awaited()

    async def test_missing_directory_traversal_absolute_and_external_symlink_are_not_found(self):
        outside = self.fixture_root / "outside.mp3"
        outside.write_bytes(b"must-not-be-served")
        (self.uploads / "directory").mkdir()
        (self.uploads / "external.mp3").symlink_to(outside)
        for audio_path in ("missing.mp3", "directory", "../outside.mp3", str(outside), "external.mp3"):
            with self.subTest(audio_path=audio_path):
                self.task.audio_url = audio_path
                await self.assert_route_status(404)
        self.storage.download.assert_not_awaited()

    async def test_remote_signed_url_redirects_without_downloading(self):
        self.task.audio_url = "audio-insight/2026/synthetic.mp3"
        self.storage = SimpleNamespace(
            get_url=AsyncMock(return_value="https://storage.invalid/audio.mp3?signature=synthetic"),
            download=AsyncMock(side_effect=AssertionError("Remote playback must not download")))
        response = await self.call_route(ranges=("bytes=0-9",))
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "https://storage.invalid/audio.mp3?signature=synthetic")
        self.storage.get_url.assert_awaited_once_with(self.task.audio_url, expires=7200)
        self.storage.download.assert_not_awaited()

    async def test_remote_invalid_url_or_signing_failure_is_sanitized_502_without_downloading(self):
        for value, failure in (("/relative/file", None), (None, RuntimeError("private-path-and-provider-details"))):
            with self.subTest(signing_failure=bool(failure)):
                self.storage = SimpleNamespace(get_url=AsyncMock(return_value=value, side_effect=failure),
                    download=AsyncMock(side_effect=AssertionError("Remote playback must not download")))
                error = await self.assert_route_status(502)
                self.assertNotIn("private-path-and-provider-details", error.detail)
                self.storage.download.assert_not_awaited()


@unittest.skipIf(StarletteFileResponse is None, "host Python has no Starlette; run ASGI cases in audio dependency environment")
class AudioPlaybackASGITests(PlaybackFixture, unittest.IsolatedAsyncioTestCase):
    async def send_response(self, response, ranges=(), collect=True):
        output = {"status": None, "headers": {}, "total_bytes": 0, "max_chunk_bytes": 0,
                  "body_events": 0, "digest": hashlib.sha256(), "parts": []}

        async def send(message):
            if message["type"] == "http.response.start":
                output["status"] = message["status"]
                output["headers"] = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in message["headers"]}
            elif message["type"] == "http.response.body":
                body = message.get("body", b"")
                output["body_events"] += 1
                output["total_bytes"] += len(body)
                output["max_chunk_bytes"] = max(output["max_chunk_bytes"], len(body))
                output["digest"].update(body)
                if collect:
                    output["parts"].append(body)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        await response(scope_for(ranges), receive, send)
        output["sha256"] = output.pop("digest").hexdigest()
        output["body"] = b"".join(output.pop("parts")) if collect else None
        return output

    async def test_full_file_actual_asgi_response(self):
        with patch.object(Path, "read_bytes", side_effect=AssertionError("No whole-file reads")):
            response = await self.call_route()
            result = await self.send_response(response)
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["body"], self.content)
        self.assertEqual(result["headers"]["content-type"], "audio/mpeg")
        self.assertEqual(result["headers"]["content-length"], str(len(self.content)))
        self.assertEqual(result["headers"]["accept-ranges"], "bytes")
        self.assertNotIn("attachment", result["headers"].get("content-disposition", ""))
        self.storage.download.assert_not_awaited()

    async def test_standard_suffix_and_open_ranges_actual_asgi_206(self):
        cases = [("bytes=0-9", 0, 10), ("bytes=100-", 100, len(self.content)),
                 ("bytes=-10", len(self.content) - 10, len(self.content))]
        for header, start, end in cases:
            with self.subTest(range=header):
                with patch.object(Path, "read_bytes", side_effect=AssertionError("No whole-file reads")):
                    response = await self.call_route(ranges=(header,))
                    result = await self.send_response(response, ranges=(header,))
                self.assertEqual(result["status"], 206)
                self.assertEqual(result["body"], self.content[start:end])
                self.assertEqual(result["headers"]["content-range"], f"bytes {start}-{end - 1}/{len(self.content)}")
                self.assertEqual(result["headers"]["content-length"], str(end - start))
        self.storage.download.assert_not_awaited()

    async def test_beyond_eof_actual_asgi_416(self):
        header = f"bytes={len(self.content) + 1}-"
        response = await self.call_route(ranges=(header,))
        result = await self.send_response(response, ranges=(header,))
        self.assertEqual(result["status"], 416)
        # Starlette 0.41.3 emits */N; later releases may include the bytes unit.
        self.assertTrue(result["headers"]["content-range"].endswith(f"*/{len(self.content)}"))
        self.storage.download.assert_not_awaited()

    async def test_large_file_actual_asgi_never_buffers_and_max_chunk_64k(self):
        block = bytes(range(256)) * 256
        repeats = 129  # More than 8 MiB, including a trailing partial chunk.
        digest = hashlib.sha256()
        with self.file.open("wb") as output:
            for _ in range(repeats):
                output.write(block)
                digest.update(block)
            output.write(b"tail")
            digest.update(b"tail")
        with patch.object(Path, "read_bytes", side_effect=AssertionError("No whole-file reads")):
            response = await self.call_route()
            result = await self.send_response(response, collect=False)
        expected_size = len(block) * repeats + 4
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["total_bytes"], expected_size)
        self.assertEqual(result["sha256"], digest.hexdigest())
        self.assertLessEqual(result["max_chunk_bytes"], 64 * 1024)
        self.assertGreater(result["body_events"], 1)
        self.assertIsNone(result["body"])
        self.storage.download.assert_not_awaited()
        RUN_METRICS.append({"starlette": starlette.__version__, "large_file_bytes": expected_size,
                            "max_chunk_bytes": result["max_chunk_bytes"], "body_events": result["body_events"],
                            "sha256": result["sha256"], "download_calls": self.storage.download.await_count})

    async def test_remote_redirect_actual_asgi_has_no_file_body(self):
        self.storage = SimpleNamespace(get_url=AsyncMock(return_value="https://storage.invalid/synthetic.mp3"),
            download=AsyncMock(side_effect=AssertionError("No remote download")))
        response = await self.call_route(ranges=("bytes=0-9",))
        result = await self.send_response(response, ranges=("bytes=0-9",))
        self.assertEqual(result["status"], 307)
        self.assertEqual(result["headers"]["location"], "https://storage.invalid/synthetic.mp3")
        self.assertEqual(result["total_bytes"], 0)
        self.storage.download.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
