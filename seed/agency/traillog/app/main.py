"""main.py — FastAPI app for the self-contained TrailLog demo.

Serves a single Leaflet web page plus the live-tracking websockets and a couple
of REST endpoints. On startup it launches the GPS simulator, so opening the page
immediately shows a courier moving along a route with a live ETA and the
notification log (push/SMS) filling in as stops are reached. No keys, no infra.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

from app.db import store
from app.notifications.dispatcher import SENT_LOG, build_default_dispatcher
from app.seed_data import DEMO_ROUTE_ID
from app.simulator import run_forever
from app.tracking.ws import router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

WEB_DIR = Path(__file__).parent / "web"
dispatcher = build_default_dispatcher()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(run_forever(dispatcher))
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="TrailLog", lifespan=lifespan)
app.include_router(ws_router)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/route")
def route_info() -> JSONResponse:
    """Static route metadata the page needs to draw stops and center the map."""
    route = store().routes.get(DEMO_ROUTE_ID)
    if route is None:
        return JSONResponse({"detail": "route not seeded yet"}, status_code=503)
    return JSONResponse(
        {
            "route_id": route.id,
            "driver_name": route.driver_name,
            "status": route.status.value,
            "stops": [
                {"id": s.id, "address": s.address, "lat": s.lat, "lng": s.lng,
                 "completed": s.completed_at is not None}
                for s in store().stops_for(route.id)
            ],
            "path": [{"lat": lat, "lng": lng} for lat, lng in route.path],
        }
    )


@app.get("/api/position/{route_id}")
def live_position(route_id: int) -> JSONResponse:
    """Latest known driver position + ETA (poll fallback if WS isn't used)."""
    pos = store().positions.get(route_id)
    if pos is None:
        return JSONResponse({"detail": "no position yet"}, status_code=404)
    from app.tracking.geolocation import progress_for_position

    progress = progress_for_position(store(), route_id, pos.lat, pos.lng)
    progress.update({"lat": pos.lat, "lng": pos.lng,
                     "recorded_at": pos.recorded_at.isoformat()})
    return JSONResponse(progress)


@app.get("/api/notifications")
def notifications() -> JSONResponse:
    """The dispatcher log (most recent first) — push/SMS sends."""
    return JSONResponse([asdict(e) for e in reversed(SENT_LOG)])
