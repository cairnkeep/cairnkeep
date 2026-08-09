#!/usr/bin/env python3

import json
from pathlib import Path
import sys


report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
events = {event["category"]: event for event in report["events"]}
required = {
    "prime-write",
    "fresh-prime-read",
    "independent-client-read",
    "server-restart",
    "server-restart-read",
}
assert report["error_count"] == 0
assert required <= events.keys(), sorted(required - events.keys())
print("Spike 003 evidence: PASS")
