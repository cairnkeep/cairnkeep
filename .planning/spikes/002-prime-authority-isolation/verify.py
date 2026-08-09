#!/usr/bin/env python3

import json
from pathlib import Path
import sys


report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
events = {event["category"]: event for event in report["events"]}
required = {
    "prime-discovery",
    "annotation-boundary",
    "least-authority",
    "project-isolation",
    "missing-token",
    "invalid-token",
}
assert report["error_count"] == 0
assert required <= events.keys(), sorted(required - events.keys())
assert events["prime-discovery"]["metadata"]["tools"] == [
    "memory_read",
    "memory_write",
    "memory_search",
]
assert events["annotation-boundary"]["metadata"][
    "prime_catalog_preserves_annotations"
] is False
print("Spike 002 evidence: PASS")
