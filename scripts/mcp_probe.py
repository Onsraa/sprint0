"""Probe the official MongoDB MCP server: spawn it over stdio, list its tools.
Phase 2 step toward verifying vector search runs THROUGH the partner MCP.

Run: uv run python scripts/mcp_probe.py
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402

URI = os.environ["MONGODB_URI"]
PARAMS = StdioServerParameters(
    command="npx",
    args=["-y", "mongodb-mcp-server", "--connectionString", URI],
)


async def main() -> None:
    async with stdio_client(PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"-- mongodb-mcp-server exposes {len(tools.tools)} tools --")
            for t in tools.tools:
                print(f"  • {t.name}: {(t.description or '').splitlines()[0][:80]}")


if __name__ == "__main__":
    asyncio.run(main())
