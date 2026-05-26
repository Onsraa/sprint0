"""Verify Atlas Vector Search runs THROUGH the official MongoDB MCP (the judged
partner integration). We embed the query with Voyage, then call the MCP's
`aggregate` tool with a $vectorSearch pipeline.

Run: uv run python scripts/mcp_vector_search.py ["your brief here"]
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parent.parent
load_dotenv(REPO / ".env")

import voyageai  # noqa: E402
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402

URI = os.environ["MONGODB_URI"]
DB = os.getenv("MONGODB_DB", "orchestrator")
PP_INDEX = os.getenv("PAST_PROJECTS_VECTOR_INDEX", "pp_vector_index")
MODEL = os.getenv("VOYAGE_MODEL", "voyage-3.5-lite")
DIMS = int(os.getenv("EMBEDDING_DIMS", "1024"))

QUERY = sys.argv[1] if len(sys.argv) > 1 else "real-estate listings marketplace with a map and an agent CRM"

qv = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"]).embed(
    [QUERY], model=MODEL, input_type="query", output_dimension=DIMS
).embeddings[0]

PIPELINE = [
    {"$vectorSearch": {"index": PP_INDEX, "path": "brief_embedding", "queryVector": qv, "numCandidates": 50, "limit": 3}},
    {"$project": {"_id": 0, "name": 1, "tags": 1, "score": {"$meta": "vectorSearchScore"}}},
]

PARAMS = StdioServerParameters(command="npx", args=["-y", "mongodb-mcp-server", "--connectionString", URI])

_done = False


async def main() -> None:
    global _done
    async with stdio_client(PARAMS) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.call_tool(
                "aggregate", {"database": DB, "collection": "PastProjects", "pipeline": PIPELINE}
            )
            print(f"query: {QUERY!r}")
            print("--- $vectorSearch via MongoDB MCP `aggregate` tool ---")
            for block in res.content:
                text = getattr(block, "text", None)
                if text:
                    print(text)
            _done = True


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException:
        if not _done:
            raise  # real failure; otherwise ignore stdio teardown noise
