"""simulator.py — fake GPS: tick a driver along a route.

Stands in for the real driver phone streaming pings over /ws/driver. Walks the
seeded road path at a fixed speed, interpolating between waypoints so the marker
glides. On the way it marks stops complete and fires notifications via the
dispatcher (driver-arriving when close, delivered when reached), so the page
shows both the moving marker AND the notification log filling up.
"""

from __future__ import annotations

import asyncio
import logging

from app.db import store
from app.models.route import Route, RouteStatus
from app.notifications.dispatcher import (
    NotificationDispatcher,
    delivered,
    driver_arriving,
)
from app.seed_data import RECIPIENTS, build_demo_route
from app.tracking.geolocation import AVG_SPEED_MPS, distance_to_stop_m, haversine_m
from app.tracking.ws import broadcast_position

log = logging.getLogger("traillog.simulator")

TICK_SECONDS = 1.0          # how often we emit a position
SPEED_MPS = AVG_SPEED_MPS   # courier speed used to step along the path
ARRIVING_RADIUS_M = 250.0   # fire "arriving" notification within this distance
DELIVERED_RADIUS_M = 35.0   # mark a stop delivered within this distance


def _interpolate(path: list[tuple[float, float]], step_m: float):
    """Yield (lat, lng) points walking `path`, ~step_m apart along each leg."""
    for (lat1, lng1), (lat2, lng2) in zip(path, path[1:]):
        leg_m = haversine_m(lat1, lng1, lat2, lng2)
        steps = max(1, int(leg_m / step_m))
        for i in range(steps):
            t = i / steps
            yield (lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t)
    yield path[-1]


async def run_route(route: Route, dispatcher: NotificationDispatcher) -> None:
    """Drive `route` to completion, emitting positions and notifications."""
    route.status = RouteStatus.ACTIVE
    arriving_sent: set[int] = set()

    for lat, lng in _interpolate(route.path, SPEED_MPS * TICK_SECONDS):
        await broadcast_position(route.id, lat, lng)

        for stop in store().stops_for(route.id):
            if stop.completed_at is not None:
                continue
            dist = distance_to_stop_m(lat, lng, stop)
            recipient = RECIPIENTS.get(stop.id)

            if dist <= ARRIVING_RADIUS_M and stop.id not in arriving_sent and recipient:
                eta_min = max(1, round(dist / SPEED_MPS / 60))
                driver_arriving(dispatcher, recipient, eta_min)
                arriving_sent.add(stop.id)

            if dist <= DELIVERED_RADIUS_M:
                import datetime as dt

                stop.completed_at = dt.datetime.now()
                log.info("Stop %s delivered: %s", stop.id, stop.address)
                if recipient:
                    delivered(dispatcher, recipient, stop.address)

        await asyncio.sleep(TICK_SECONDS)

    route.status = RouteStatus.COMPLETED
    log.info("Route %s completed", route.id)


async def run_forever(dispatcher: NotificationDispatcher) -> None:
    """Loop the demo route so a freshly opened page always sees movement."""
    while True:
        # Fresh route each lap: reset stops + status so notifications re-fire.
        route = build_demo_route()
        store().add_route(route)
        try:
            await run_route(route, dispatcher)
        except asyncio.CancelledError:
            raise
        except Exception:  # keep the demo alive even if a tick fails
            log.exception("Simulator tick failed; restarting route")
        await asyncio.sleep(3.0)  # brief pause, then loop again
