"""geolocation.py — live location, route progress, and ETA.

The production build pushes distance/nearest-stop into PostGIS. For the
self-contained demo we use plain haversine (great-circle) math on lat/lng,
which is plenty accurate at city scale and needs no database.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.db import Store
from app.models.route import RouteStop

# Average urban courier speed used for the naive ETA fallback (meters / second).
AVG_SPEED_MPS = 8.3  # ~30 km/h
EARTH_RADIUS_M = 6_371_000.0


@dataclass
class ETA:
    distance_m: float
    seconds: int


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters between two lat/lng points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def distance_to_stop_m(lat: float, lng: float, stop: RouteStop) -> float:
    """Great-circle distance in meters between a driver position and a stop."""
    return haversine_m(lat, lng, stop.lat, stop.lng)


def nearest_pending_stop(db: Store, route_id: int, lat: float, lng: float) -> RouteStop | None:
    """Closest not-yet-completed stop to the driver's current location."""
    pending = [s for s in db.stops_for(route_id) if s.completed_at is None]
    if not pending:
        return None
    return min(pending, key=lambda s: distance_to_stop_m(lat, lng, s))


def estimate_eta(distance_m: float, speed_mps: float = AVG_SPEED_MPS) -> ETA:
    """Naive straight-line ETA. Swap in a routing-engine duration when available."""
    speed = max(speed_mps, 0.1)
    return ETA(distance_m=distance_m, seconds=int(distance_m / speed))


def progress_for_position(db: Store, route_id: int, lat: float, lng: float) -> dict:
    """Bundle current ETA + next stop for a driver ping — what the WS layer broadcasts."""
    stop = nearest_pending_stop(db, route_id, lat, lng)
    if stop is None:
        return {"route_id": route_id, "next_stop_id": None, "eta_seconds": None}

    distance = distance_to_stop_m(lat, lng, stop)
    eta = estimate_eta(distance)
    return {
        "route_id": route_id,
        "next_stop_id": stop.id,
        "next_stop_address": stop.address,
        "distance_m": round(eta.distance_m, 1),
        "eta_seconds": eta.seconds,
    }
