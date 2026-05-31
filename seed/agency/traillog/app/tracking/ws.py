"""ws.py — websocket gateway for live tracking.

Drivers push location pings; dispatchers and customers subscribe to a route and
receive every update. The production build fans out through Redis pub/sub so it
works across workers; the self-contained demo uses an in-process broker
(app.pubsub) since it runs in a single process.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import get_session
from app.models.route import LivePosition
from app.pubsub import broker
from app.tracking.geolocation import progress_for_position

router = APIRouter()


def channel(route_id: int) -> str:
    return f"route:{route_id}:positions"


async def broadcast_position(route_id: int, lat: float, lng: float) -> dict:
    """Compute progress for a ping, persist it, and fan it out to watchers."""
    with get_session() as db:
        update = progress_for_position(db, route_id, lat, lng)
        update["lat"], update["lng"] = lat, lng
        db.upsert_position(LivePosition(route_id=route_id, lat=lat, lng=lng))
    await broker.publish(channel(route_id), json.dumps(update))
    return update


@router.websocket("/ws/driver/{route_id}")
async def driver_socket(ws: WebSocket, route_id: int):
    """Driver app connects here and streams {lat, lng} pings."""
    await ws.accept()
    try:
        while True:
            ping = await ws.receive_json()  # {"lat": .., "lng": ..}
            await broadcast_position(route_id, ping["lat"], ping["lng"])
    except WebSocketDisconnect:
        return


@router.websocket("/ws/watch/{route_id}")
async def watch_socket(ws: WebSocket, route_id: int):
    """Dispatcher / customer connects here to watch a route move in real time."""
    await ws.accept()
    queue = broker.subscribe(channel(route_id))
    try:
        while True:
            message = await queue.get()
            await ws.send_text(message)
    except WebSocketDisconnect:
        return
    finally:
        broker.unsubscribe(channel(route_id), queue)


@router.websocket("/ws/notifications")
async def notifications_socket(ws: WebSocket):
    """Live feed of dispatcher notifications (push/SMS) for the demo page."""
    from app.notifications.dispatcher import NOTIFICATIONS_CHANNEL

    await ws.accept()
    queue = broker.subscribe(NOTIFICATIONS_CHANNEL)
    try:
        while True:
            message = await queue.get()
            await ws.send_text(message)
    except WebSocketDisconnect:
        return
    finally:
        broker.unsubscribe(NOTIFICATIONS_CHANNEL, queue)
