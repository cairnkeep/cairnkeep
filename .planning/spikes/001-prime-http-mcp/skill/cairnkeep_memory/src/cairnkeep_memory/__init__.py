"""Cairnkeep tools auto-discovered from an authenticated HTTP MCP server."""

from __future__ import annotations

from rlm import McpIntegration

__all__ = ["CairnkeepMemory", "cairnkeep_memory"]


class CairnkeepMemory(McpIntegration):
    """Prime Agent integration for a locally protected Cairnkeep endpoint."""

    server = "cairn-memory"
    url = "http://127.0.0.1:7801/mcp"
    bearer_token_env = "CAIRN_MEMORY_HTTP_TOKEN"


cairnkeep_memory = CairnkeepMemory()


_RESERVED = {"run", "__wrapped__", "__call__"}


def __getattr__(name: str):
    if name.startswith("_") or name in _RESERVED:
        raise AttributeError(name)
    return getattr(cairnkeep_memory, name)
