"""db.py — in-memory store for the self-contained demo.

The production build uses Postgres + PostGIS; for a zero-dependency local demo we
keep everything in process. `get_session()` hands out the single shared store so
call sites read like the SQLAlchemy version (`with get_session() as db: ...`).
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from app.models.route import LivePosition, Route, RouteStop


class Store:
    """Tiny in-memory database: dicts keyed by id, plus the latest position."""

    def __init__(self) -> None:
        self.routes: dict[int, Route] = {}
        self.stops: dict[int, RouteStop] = {}
        self.positions: dict[int, LivePosition] = {}  # route_id -> latest position

    def add_route(self, route: Route) -> Route:
        self.routes[route.id] = route
        for stop in route.stops:
            self.stops[stop.id] = stop
        return route

    def stops_for(self, route_id: int) -> list[RouteStop]:
        return sorted(
            (s for s in self.stops.values() if s.route_id == route_id),
            key=lambda s: s.sequence,
        )

    def upsert_position(self, position: LivePosition) -> None:
        self.positions[position.route_id] = position


_store = Store()


@contextmanager
def get_session() -> Iterator[Store]:
    """Yield the shared in-memory store. Mirrors the DB-session call shape."""
    yield _store


def store() -> Store:
    """Direct accessor for code that isn't using the session contextmanager."""
    return _store
