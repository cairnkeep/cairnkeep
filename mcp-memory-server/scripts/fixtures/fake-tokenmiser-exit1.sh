#!/bin/sh
# Fixture: stands in for token_miser exiting non-zero (execution-tier failure).
echo "Error: simulated token_miser failure" >&2
exit 1
