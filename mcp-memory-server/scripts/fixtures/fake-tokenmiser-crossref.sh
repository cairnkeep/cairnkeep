#!/bin/sh
# Fixture for smoke-explore-crossref.mjs: cites src/widget.rs and src/gadget.rs
# -- "widget"/"gadget" stems are both >= 4 chars (D-02's noise guard), unlike
# fake-tokenmiser-cited.sh's "foo"/"bar" (3 chars, would never cross-ref).
cat <<'JSON'
{
  "citations": [
    { "path": "src/widget.rs", "start_line": 10, "end_line": 42 },
    { "path": "src/gadget.rs", "start_line": 5, "end_line": 9 }
  ],
  "expanded_snippets": [
    { "path": "src/widget.rs", "start_line": 10, "end_line": 42, "code": "fn widget() {}" }
  ],
  "stats": {
    "turns": 3,
    "tool_calls": 4
  }
}
JSON
exit 0
