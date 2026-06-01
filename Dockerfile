# sprint0 gateway: FastAPI (Python) + the official MongoDB MCP server (Node/npx) in ONE image.
# Cloud Run injects MONGODB_URI / VOYAGE_API_KEY / GITLAB_TOKEN / LIVE_UNLOCK_TOKEN / DEMO_MODE as env.
FROM python:3.12-slim-bookworm

# ── Node 20 (for `npx mongodb-mcp-server`) ──
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# uv (frozen installs from uv.lock)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# ── Python deps (cached layer) ──
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# ── Pre-bake the MCP server so the cold-start spawn is unpack-only, not a live npm fetch ──
# Pinned for reproducible builds (current latest as of deploy). Bump deliberately, not by drift.
RUN npm install -g mongodb-mcp-server@1.11.0

# ── App source ──
COPY orchestrator/ ./orchestrator/
COPY scripts/ ./scripts/

ENV PYTHONPATH=/app/orchestrator \
    PYTHONUNBUFFERED=1 \
    DEMO_MODE=true \
    PORT=8080
EXPOSE 8080

# One worker: the MCP session + _MCP_LOCK (rag.py) are process-global singletons; extra workers
# would each spawn a redundant npx child. Scale via Cloud Run instances, not workers. Cloud Run sets $PORT.
CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
