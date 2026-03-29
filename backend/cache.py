"""
Activation cache — uses Redis/Upstash when available, falls back to in-memory LRU.
"""

import json
import os
from collections import OrderedDict
from typing import Optional


class ActivationCache:
    def __init__(self, max_memory_items: int = 1000):
        self._memory = OrderedDict()
        self._max = max_memory_items
        self._redis = None

        redis_url = os.environ.get("UPSTASH_REDIS_URL")
        redis_token = os.environ.get("UPSTASH_REDIS_TOKEN")
        if redis_url and redis_token:
            try:
                from upstash_redis import Redis
                self._redis = Redis(url=redis_url, token=redis_token)
            except ImportError:
                pass

    def get(self, key: str) -> Optional[dict]:
        if self._redis:
            try:
                val = self._redis.get(key)
                if val:
                    return json.loads(val) if isinstance(val, str) else val
            except Exception:
                pass

        if key in self._memory:
            self._memory.move_to_end(key)
            return self._memory[key]

        return None

    def set(self, key: str, value: dict, ttl: int = 604800):
        if self._redis:
            try:
                self._redis.set(key, json.dumps(value), ex=ttl)
            except Exception:
                pass

        self._memory[key] = value
        self._memory.move_to_end(key)
        if len(self._memory) > self._max:
            self._memory.popitem(last=False)
