#!/bin/sh
# Fixture: stands in for token_miser, logging one line per invocation to
# $EXPLORE_HIT_LOG (so a test can prove "the binary was NOT re-spawned" on a
# cache hit by asserting the log's line count stays flat), then emits the
# same valid populated Evidence JSON shape as fake-tokenmiser-cited.sh, exit 0.
if [ -n "$EXPLORE_HIT_LOG" ]; then
  echo "invocation" >> "$EXPLORE_HIT_LOG"
fi
cat <<'JSON'
{
  "citations": [
    { "path": "src/foo.rs", "start_line": 10, "end_line": 42 },
    { "path": "src/bar.rs", "start_line": 5, "end_line": 9 }
  ],
  "expanded_snippets": [
    { "path": "src/foo.rs", "start_line": 10, "end_line": 42, "code": "fn foo() {}" }
  ],
  "stats": {
    "turns": 3,
    "tool_calls": 4,
    "hit_turn_cap": false,
    "expanded_lines": 33,
    "expanded_tokens": 120
  }
}
JSON
exit 0
