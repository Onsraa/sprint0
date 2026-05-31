"""route.py — route, stop, and live-position models.

The production build uses SQLAlchemy + GeoAlchemy2 with PostGIS POINT columns
(SRID 4326). For the self-contained demo these are plain dataclasses holding
lat/lng floats; the geo math lives in tracking/geolocation.py (haversine).
"""

from __future__ import annotations

import datetime as dt
import enum
from dataclasses import dataclass, field


class RouteStatus(str, enum.Enum):
    PLANNED = "planned"
    ACTIVE = "active"
    COMPLETED = "completed"


@dataclass
class RouteStop:
    id: int
    route_id: int
    sequence: int
    address: str
    lat: float
    lng: float
    completed_at: dt.datetime | None = None


@dataclass
class Route:
    id: int
    driver_id: int
    driver_name: str
    status: RouteStatus = RouteStatus.PLANNED
    stops: list[RouteStop] = field(default_factory=list)
    # Ordered lat/lng waypoints the driver follows (the road path to animate).
    path: list[tuple[float, float]] = field(default_factory=list)
    created_at: dt.datetime = field(default_factory=dt.datetime.utcnow)


@dataclass
class LivePosition:
    """Latest known position for a driver/route — upserted on every ping."""

    route_id: int
    lat: float
    lng: float
    heading: float | None = None
    recorded_at: dt.datetime = field(default_factory=dt.datetime.utcnow)
