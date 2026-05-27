"""pubsub.py — in-process async pub/sub broker.

Replaces Redis pub/sub for the single-process demo. Subscribers get an
asyncio.Queue; publishing fans a message out to every queue on that channel.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict


class PubSub:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[channel].add(queue)
        return queue

    def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        self._subscribers[channel].discard(queue)

    async def publish(self, channel: str, message: str) -> None:
        for queue in list(self._subscribers[channel]):
            await queue.put(message)


# Single shared broker for the process.
broker = PubSub()
