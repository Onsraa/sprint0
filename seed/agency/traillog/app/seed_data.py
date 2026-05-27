"""seed_data.py — demo route + recipients for the self-contained app.

A single courier route through downtown San Francisco with two delivery stops
and a hand-drawn road path to animate the marker along. No external geocoding.
"""

from __future__ import annotations

from app.models.route import Route, RouteStatus, RouteStop
from app.notifications.dispatcher import Recipient

DEMO_ROUTE_ID = 1

# Customers waiting on the two stops. push_token present -> push; else SMS.
RECIPIENTS: dict[int, Recipient] = {
    # keyed by stop id
    101: Recipient(name="Ava Chen", phone="+14155550101", push_token="demo-push-ava"),
    102: Recipient(name="Marco Diaz", phone="+14155550102"),  # SMS only (no token)
}

# Ordered road path (lat, lng) from the depot to the final stop, through downtown SF.
# Roughly: Embarcadero -> Market St -> Union Square area.
PATH: list[tuple[float, float]] = [
    (37.7955, -122.3937),  # Ferry Building / Embarcadero (depot)
    (37.7944, -122.3955),
    (37.7929, -122.3971),
    (37.7918, -122.3986),
    (37.7906, -122.4001),
    (37.7895, -122.4016),  # near stop 1 (Market & Battery area)
    (37.7884, -122.4032),
    (37.7872, -122.4049),
    (37.7861, -122.4065),
    (37.7869, -122.4080),
    (37.7877, -122.4094),
    (37.7886, -122.4108),  # near stop 2 (Union Square area)
]


def build_demo_route() -> Route:
    stops = [
        RouteStop(
            id=101,
            route_id=DEMO_ROUTE_ID,
            sequence=1,
            address="100 Pine St, San Francisco",
            lat=37.7895,
            lng=-122.4016,
        ),
        RouteStop(
            id=102,
            route_id=DEMO_ROUTE_ID,
            sequence=2,
            address="333 Post St (Union Square), San Francisco",
            lat=37.7886,
            lng=-122.4108,
        ),
    ]
    return Route(
        id=DEMO_ROUTE_ID,
        driver_id=7,
        driver_name="Jordan (Van 7)",
        status=RouteStatus.PLANNED,
        stops=stops,
        path=PATH,
    )
