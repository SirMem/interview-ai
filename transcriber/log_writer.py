"""
Structured logger — OTel backed (delegates to telemetry.log).

Same `log(event, level='INFO', **fields)` signature as the old NDJSON writer.
The on-disk NDJSON writer was removed in the Latency & Observability Overhaul
— Grafana Cloud is now the single destination for structured events.
"""
from __future__ import annotations

import telemetry


def log(event: str, level: str = 'INFO', **fields):
    telemetry.log(event, level=level, **fields)
