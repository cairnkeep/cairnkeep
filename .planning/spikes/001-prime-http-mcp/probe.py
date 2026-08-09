#!/usr/bin/env python3
"""Executable Prime Agent ↔ Cairnkeep integration spike.

Run with Prime Agent's kernel Python so the probe exercises the exact `rlm`
runtime installed for Prime rather than a stand-in client.
"""

from __future__ import annotations

import argparse
import asyncio
from contextlib import AsyncExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from types import MethodType
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from rlm import NotEnabled


SPIKE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SPIKE_DIR.parents[2]
SKILL_SRC = SPIKE_DIR / "skill" / "cairnkeep_memory" / "src"
sys.path.insert(0, str(SKILL_SRC))

from cairnkeep_memory import CairnkeepMemory  # noqa: E402


class Evidence:
    def __init__(self) -> None:
        self.started_at = time.monotonic()
        self.events: list[dict[str, Any]] = []

    def add(self, category: str, outcome: str, **metadata: Any) -> None:
        self.events.append(
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "category": category,
                "outcome": outcome,
                "metadata": metadata,
            }
        )

    def report(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "duration_ms": round((time.monotonic() - self.started_at) * 1000),
            "event_count": len(self.events),
            "error_count": sum(event["outcome"] == "error" for event in self.events),
            "events": self.events,
        }


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])


def wait_for_server(process: subprocess.Popen[str], port: int) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read() if process.stderr else ""
            raise RuntimeError(f"Cairnkeep exited during startup: {stderr}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError("Cairnkeep did not start within 15 seconds")


def configured_adapter(endpoint: str, project: str) -> CairnkeepMemory:
    adapter = CairnkeepMemory()

    async def resolve_config(_self: CairnkeepMemory) -> tuple[str, dict[str, str]]:
        return endpoint, {"X-Cairn-Project": project}

    adapter._resolve_config = MethodType(resolve_config, adapter)
    return adapter


async def raw_session(endpoint: str, token: str, project: str):
    stack = AsyncExitStack()
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Cairn-Project": project,
    }
    client = await stack.enter_async_context(httpx.AsyncClient(headers=headers))
    streams = await stack.enter_async_context(
        streamable_http_client(endpoint, http_client=client)
    )
    session = await stack.enter_async_context(ClientSession(streams[0], streams[1]))
    await session.initialize()
    return stack, session


async def run(endpoint: str, token: str, evidence: Evidence) -> None:
    project_a = "prime-spike-a"
    project_b = "prime-spike-b"
    key = "patterns/prime-agent-canary"
    value = "Prime Agent and Cairnkeep share durable memory through HTTP MCP."
    os.environ["CAIRN_MEMORY_HTTP_TOKEN"] = token

    adapter = configured_adapter(endpoint, project_a)
    tools = await adapter.list_tools()
    names = [tool["name"] for tool in tools]
    expected = ["memory_read", "memory_write", "memory_search"]
    assert names == expected, (names, expected)
    assert all(set(tool) == {"name", "description", "inputSchema"} for tool in tools)
    evidence.add("prime-discovery", "passed", tools=names, exposed_fields=sorted(tools[0]))

    stack, raw = await raw_session(endpoint, token, project_a)
    try:
        raw_tools = (await raw.list_tools()).tools
        annotation_rows = {
            tool.name: {
                "readOnlyHint": tool.annotations.read_only_hint,
                "destructiveHint": tool.annotations.destructive_hint,
                "idempotentHint": tool.annotations.idempotent_hint,
                "openWorldHint": tool.annotations.open_world_hint,
            }
            for tool in raw_tools
        }
    finally:
        await stack.aclose()
    assert annotation_rows["memory_read"]["readOnlyHint"] is True
    assert annotation_rows["memory_write"]["readOnlyHint"] is False
    evidence.add(
        "annotation-boundary",
        "passed",
        raw_mcp_annotations=annotation_rows,
        prime_catalog_preserves_annotations=False,
    )

    try:
        await adapter.context_explore(query="must remain unavailable")
        raise AssertionError("disallowed tool unexpectedly executed")
    except AttributeError:
        evidence.add("least-authority", "passed", disallowed_tool="context_explore")

    write_result = await adapter.memory_write(scope="project", key=key, value=value)
    assert key in json.dumps(write_result, sort_keys=True)
    evidence.add("prime-write", "passed", project=project_a, key=key)

    fresh_adapter = configured_adapter(endpoint, project_a)
    fresh_read = await fresh_adapter.memory_read(scope="project", key=key)
    assert value in json.dumps(fresh_read, sort_keys=True)
    evidence.add("fresh-prime-read", "passed", project=project_a, key=key)

    stack, independent = await raw_session(endpoint, token, project_a)
    try:
        independent_read = await independent.call_tool(
            "memory_read", {"scope": "project", "key": key}
        )
        assert value in independent_read.model_dump_json()
    finally:
        await stack.aclose()
    evidence.add("independent-client-read", "passed", project=project_a, key=key)

    isolated_adapter = configured_adapter(endpoint, project_b)
    isolated_read = await isolated_adapter.memory_read(scope="project", key=key)
    assert value not in json.dumps(isolated_read, sort_keys=True)
    evidence.add("project-isolation", "passed", absent_from=project_b, key=key)

    del os.environ["CAIRN_MEMORY_HTTP_TOKEN"]
    try:
        await configured_adapter(endpoint, project_a).list_tools()
        raise AssertionError("missing bearer token unexpectedly authenticated")
    except NotEnabled:
        evidence.add("missing-token", "passed")

    os.environ["CAIRN_MEMORY_HTTP_TOKEN"] = "invalid-token"
    invalid_error: Exception | None = None
    try:
        await configured_adapter(endpoint, project_a).list_tools()
    except Exception as error:
        invalid_error = error
    if invalid_error is None:
        raise AssertionError("invalid bearer token unexpectedly authenticated")
    evidence.add("invalid-token", "passed", error_type=type(invalid_error).__name__)


async def verify_restart(endpoint: str, token: str, evidence: Evidence) -> None:
    os.environ["CAIRN_MEMORY_HTTP_TOKEN"] = token
    value = "Prime Agent and Cairnkeep share durable memory through HTTP MCP."
    restarted = configured_adapter(endpoint, "prime-spike-a")
    result = await restarted.memory_read(
        scope="project", key="patterns/prime-agent-canary"
    )
    assert value in json.dumps(result, sort_keys=True)
    evidence.add("server-restart-read", "passed", project="prime-spike-a")


def start_server(
    cairn: Path, server_project: Path, store: Path, token: str
) -> tuple[subprocess.Popen[str], str]:
    port = free_port()
    endpoint = f"http://127.0.0.1:{port}/mcp"
    env = {
        **os.environ,
        "CAIRN_AGENTFS_BASE_DIR": str(store),
        "CAIRN_MEMORY_HTTP_TOKEN": token,
        "CAIRN_MEMORY_HTTP_ALLOWED_HOSTS": f"127.0.0.1:{port}",
        "CAIRN_MCP_TOOL_PROFILE": "custom",
        "CAIRN_MCP_ALLOWED_TOOLS": "memory_read,memory_write,memory_search",
        "MCP_HTTP_HOST": "127.0.0.1",
        "MCP_HTTP_PORT": str(port),
    }
    process = subprocess.Popen(
        [str(cairn), "memory-server"],
        cwd=server_project,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    wait_for_server(process, port)
    return process, endpoint


def stop_server(process: subprocess.Popen[str]) -> None:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    evidence = Evidence()
    cairn = REPO_ROOT / "bin" / "cairn"
    server_entry = REPO_ROOT / "mcp-memory-server" / "dist" / "index.js"
    if not cairn.is_file() or not server_entry.is_file():
        raise SystemExit("Build Cairnkeep first with: npm run build:server")

    with tempfile.TemporaryDirectory(prefix="cairn-prime-spike-") as directory:
        root = Path(directory)
        server_project = root / "server-project"
        store = root / "store"
        server_project.mkdir()
        store.mkdir()
        token = secrets.token_hex(32)
        process, endpoint = start_server(cairn, server_project, store, token)
        try:
            evidence.add("server-start", "passed", endpoint=endpoint, profile="custom")
            asyncio.run(run(endpoint, token, evidence))
            stop_server(process)
            process, endpoint = start_server(cairn, server_project, store, token)
            evidence.add("server-restart", "passed", endpoint=endpoint)
            asyncio.run(verify_restart(endpoint, token, evidence))
        except Exception as error:
            evidence.add("probe", "error", error_type=type(error).__name__, message=str(error))
            raise
        finally:
            if process.poll() is None:
                stop_server(process)
            os.environ.pop("CAIRN_MEMORY_HTTP_TOKEN", None)

    report = evidence.report()
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
