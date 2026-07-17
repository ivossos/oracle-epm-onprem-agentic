"""Holds stdio connections to the wired-up MCP servers for the app's lifetime."""
import asyncio
import os
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from .config import MCP_SERVER_SCRIPTS, REPO_ROOT, TSX_BIN


class McpToolPool:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self._session_by_tool: dict[str, ClientSession] = {}
        self._lock_by_tool: dict[str, asyncio.Lock] = {}
        self.anthropic_tools: list[dict] = []

    async def connect(self) -> None:
        for label, script in MCP_SERVER_SCRIPTS.items():
            params = StdioServerParameters(
                command=str(TSX_BIN),
                args=[str(script)],
                cwd=str(REPO_ROOT),
                env=os.environ.copy(),
            )
            read, write = await self._stack.enter_async_context(stdio_client(params))
            session = await self._stack.enter_async_context(ClientSession(read, write))
            await session.initialize()

            lock = asyncio.Lock()
            listed = await session.list_tools()
            for tool in listed.tools:
                self._session_by_tool[tool.name] = session
                self._lock_by_tool[tool.name] = lock
                self.anthropic_tools.append({
                    "name": tool.name,
                    "description": tool.description or "",
                    "input_schema": tool.inputSchema,
                })

    async def call_tool(self, name: str, arguments: dict) -> tuple[str, bool]:
        session = self._session_by_tool[name]
        lock = self._lock_by_tool[name]
        async with lock:
            result = await session.call_tool(name, arguments)
        text = "\n".join(block.text for block in result.content if block.type == "text")
        return text, bool(result.isError)

    async def close(self) -> None:
        await self._stack.aclose()
