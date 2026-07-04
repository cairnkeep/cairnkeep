#!/bin/sh
# Fixture: stands in for token_miser's valid populated Evidence result, exit 0.
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
