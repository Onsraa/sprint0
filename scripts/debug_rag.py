import asyncio

from app.rag import PP_COLL, PP_INDEX, MongoMCP, embed_query

BRIEF = "A courier startup needs last-mile delivery tracking: live driver location on a map, ETA, proof-of-delivery photo, dispatcher console. Realtime is critical."


async def main() -> None:
    async with MongoMCP() as m:
        qv = embed_query(BRIEF)
        print("query dims:", len(qv))
        res = await m.session.call_tool(
            "aggregate",
            {
                "database": "sprint0",
                "collection": PP_COLL,
                "pipeline": [
                    {"$vectorSearch": {"index": PP_INDEX, "path": "brief_embedding", "queryVector": qv, "numCandidates": 50, "limit": 3}},
                    {"$project": {"_id": 0, "name": 1, "score": {"$meta": "vectorSearchScore"}}},
                ],
            },
        )
        print("isError:", getattr(res, "isError", None))
        for i, b in enumerate(res.content):
            print(f"BLOCK {i}:", repr(getattr(b, "text", b))[:500])
        print("parsed via helper:", await m.vector_search(PP_COLL, PP_INDEX, "brief_embedding", qv, 3, {"name": 1}))


if __name__ == "__main__":
    asyncio.run(main())
