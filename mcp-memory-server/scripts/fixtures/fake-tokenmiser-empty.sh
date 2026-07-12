#!/bin/sh
# Fixture: stands in for token_miser's valid but empty Evidence result, exit 0.
cat <<'JSON'
{
  "citations": [],
  "expanded_snippets": [],
  "stats": {
    "turns": 1,
    "tool_calls": 0,
    "hit_turn_cap": false,
    "expanded_lines": 0,
    "expanded_tokens": 0
  }
}
JSON
exit 0
