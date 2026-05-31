"""dispatcher.py — multi-channel notification dispatcher (push + SMS).

One entry point, `notify()`, picks channels based on what we know about the
recipient and falls back to SMS if a push token is missing or push fails.
Providers sit behind a small interface so Twilio/FCM can be swapped in for prod.

For the self-contained demo the providers are MOCKS: instead of calling FCM /
Twilio, they log to the console and append to an in-memory event log that the
web page polls (and that we fan out over pub/sub for live display). No keys.
"""

from __future__ import annotations

import abc
import asyncio
import datetime as dt
import json
import logging
from dataclasses import asdict, dataclass
from enum import Enum

from app.pubsub import broker

log = logging.getLogger("traillog.notifications")

NOTIFICATIONS_CHANNEL = "notifications"


class Channel(str, Enum):
    PUSH = "push"
    SMS = "sms"


@dataclass
class Recipient:
    name: str
    phone: str | None = None
    push_token: str | None = None


@dataclass
class NotificationEvent:
    channel: str
    recipient: str
    title: str
    body: str
    at: str


# In-memory feed of everything we've "sent" — the page renders this as the log.
SENT_LOG: list[NotificationEvent] = []


class NotificationProvider(abc.ABC):
    channel: Channel

    @abc.abstractmethod
    def send(self, recipient: Recipient, title: str, body: str) -> bool:
        """Return True on success. Must not raise for ordinary delivery failures."""


class MockPushProvider(NotificationProvider):
    """Stands in for FCM. Logs instead of calling Firebase."""

    channel = Channel.PUSH

    def send(self, recipient: Recipient, title: str, body: str) -> bool:
        if not recipient.push_token:
            return False
        log.info("[PUSH] -> %s: %s — %s", recipient.name, title, body)
        return True


class MockSmsProvider(NotificationProvider):
    """Stands in for Twilio. Logs instead of sending an SMS."""

    channel = Channel.SMS

    def send(self, recipient: Recipient, title: str, body: str) -> bool:
        if not recipient.phone:
            return False
        log.info("[SMS] -> %s: %s — %s", recipient.phone, title, body)
        return True


class NotificationDispatcher:
    """Tries push first, falls back to SMS. Records every send to the feed."""

    def __init__(self, push: NotificationProvider, sms: NotificationProvider):
        self._push = push
        self._sms = sms

    def notify(self, recipient: Recipient, title: str, body: str) -> Channel | None:
        """Deliver via the best available channel. Returns the channel used, or None."""
        used: Channel | None = None
        if recipient.push_token and self._push.send(recipient, title, body):
            used = Channel.PUSH
        elif recipient.phone and self._sms.send(recipient, title, body):
            used = Channel.SMS

        if used is None:
            log.warning("No channel succeeded for %s", recipient.name)
            return None

        event = NotificationEvent(
            channel=used.value,
            recipient=recipient.name,
            title=title,
            body=body,
            at=dt.datetime.now().strftime("%H:%M:%S"),
        )
        SENT_LOG.append(event)
        # Fan out to any live watchers (page renders it immediately).
        _publish(event)
        return used


def _publish(event: NotificationEvent) -> None:
    """Best-effort live push of a notification event over the in-process broker."""
    payload = json.dumps({"type": "notification", **asdict(event)})
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # No event loop (e.g. unit test) — the SENT_LOG poll still shows it.
    loop.create_task(broker.publish(NOTIFICATIONS_CHANNEL, payload))


def build_default_dispatcher() -> NotificationDispatcher:
    """Wire up the mock providers used by the demo."""
    return NotificationDispatcher(push=MockPushProvider(), sms=MockSmsProvider())


def driver_arriving(dispatcher: NotificationDispatcher, recipient: Recipient, eta_min: int):
    """Convenience wrapper for the most common event in the delivery flow."""
    return dispatcher.notify(
        recipient,
        title="Your delivery is almost here",
        body=f"Your courier is about {eta_min} min away.",
    )


def delivered(dispatcher: NotificationDispatcher, recipient: Recipient, address: str):
    """Notify a customer that their stop is complete."""
    return dispatcher.notify(
        recipient,
        title="Delivered",
        body=f"Your order was delivered to {address}.",
    )
