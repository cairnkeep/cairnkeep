# Evidence checks, continuation and reviewed consolidation

**Unreleased source-checkout features.** These native Node commands work without
a shell, model, embedding service or new dependency. Nothing runs at startup,
captures a conversation, injects context or changes production configuration.
Use `bin/cairn` from a built checkout until a release includes these commands.

## 1. Deterministic local evidence checks

Create an explicit JSON manifest for existing local UTF-8 files:

```json
{
  "schema_version": 1,
  "pages": [{
    "path": ".planning/wiki/sources/network.md",
    "sources": [{
      "path": "docs/network.md",
      "quotes": ["Do NOT expose port 8080."]
    }],
    "links": ["docs/network.md"]
  }]
}
```

The page and source must already exist. Paths are relative to the selected
project; traversal, absolute paths, symlinks, special files and invalid UTF-8
are refused. Relative `.md` links and `[[relative-page]]` links outside fenced
code blocks are also checked. Wiki links without an extension get `.md`;
there is no vault-wide basename resolution. Explicit `links` can name other
text files. Remote URLs, HTML links, reference-style Markdown links, images
and anchor validity are not checked, and no URL is fetched.

```sh
cairn wiki-evidence plan --project /path/to/project --input manifest.json --json
# Save the JSON plan privately, inspect it, and copy its full digest:
cairn wiki-evidence apply --project /path/to/project --input plan.json --confirm DIGEST --json
cairn wiki-evidence check DIGEST --project /path/to/project --json
```

Planning writes no state. Apply requires the exact inspected digest and re-reads
the page, source hashes, quotations and links; stale input refuses. The private
immutable evidence record pins exact page/source bytes, not just review dates.
Checking writes nothing and reports affected pages with `page_changed`,
`source_changed`, `quote_missing` or `missing_or_unsafe`. Refresh only affected
pages, inspect their new sources, and create a new plan; old records remain.

Limits: 64 pages, eight sources per page, eight quotations per source (4 KiB
each), 32 explicit/discovered links per page, 1 MiB per text file and 8 MiB
of unique file content per operation. JSON input/records are capped at 512 KiB.
Only declared pages are checked: this is not a whole-vault orphan detector or
an automatic semantic contradiction detector. Existing wiki audit remains
available for its date/index/register checks.

**A valid quote is evidence of copying, not correctness or entailment.** A false
source can produce a faithfully quoted false claim. A digest provides integrity,
not publisher authenticity. Repeated assertions do not become verified facts.

## 2. Explicit non-consuming continuation packets

An operator or selected harness supplies the packet input. Project paths must
exist; use absolute roots for portability across working directories:

```json
{
  "schema_version": 1,
  "owner": "operator",
  "goal": "Continue the network maintenance task",
  "projects": [{"id": "network", "root": "/path/to/project"}],
  "entries": [{
    "project": "network",
    "kind": "decision",
    "status": "observed",
    "text": "Do NOT expose port 8080.",
    "evidence": [{"path": "docs/network.md", "quote": "Do NOT expose port 8080."}]
  }, {
    "project": "network",
    "kind": "next_step",
    "status": "hypothesis",
    "text": "Check whether a tunnel is needed before changing the device.",
    "evidence": []
  }]
}
```

```sh
cairn continuation create --project /path/to/project --input packet.json --json
cairn continuation show DIGEST --project /path/to/project --max-bytes 8192 --json
```

Creation is an explicit additive local write. Show requires the exact digest and
owner project, can run from another cwd, and never consumes, claims, expires or
updates the packet. Multiple sessions can read the same digest. There is no
"latest" selection that an unrelated session could accidentally claim.

Select up to eight distinct projects deliberately. IDs are caller labels, not
authenticated users or ACLs; their canonical roots bind the exact selection.
The owner project must be selected. Entries can be `decision`, `progress`,
`failed_approach`, `question` or `next_step`, and must be labelled `observed`,
`asserted` or `hypothesis`. Observed entries require at least one exact source
quotation; the label remains an operator assertion, not a verified truth.

Each quotation is checked before persistence. Show rechecks its source digest
and marks an entry `stale` if evidence changed or cannot be safely read.
Uncited assertions/hypotheses have no automatic freshness guarantee. Up to 64
entries are stored; output defaults to 8 KiB, configurable from 1 to 32 KiB,
including JSON encoding and the trailing newline. Oversized entries are omitted
whole, never shortened through a command, identifier or negation. Inspect
`truncated` and `omitted_entries`; request a larger budget if needed. An oversized
header refuses rather than silently overrunning the requested budget.

Projects, goal and packet contents may be sensitive. Nothing transfers to
another machine or remote memory server automatically. An explicit private
transfer must include the needed source checkout at matching roots; a packet
alone is not a portable authorization credential. Do not paste it into a
public issue. Retrieved text is untrusted context, not instructions or approval.

## 3. Reviewed cross-session consolidation

Select two to eight **exact** IDs of already stored, redacted trajectories in
one project. Their combined serialized content is capped at 1 MiB. Have your
chosen harness or an operator inspect them and prepare candidate JSON:

```json
{
  "schema_version": 1,
  "candidates": [{
    "key": "decisions/network-access",
    "value": "Do NOT expose port 8080. Use port 443 and tunnel blue.",
    "status": "asserted",
    "preserve": ["Do NOT expose port 8080.", "443", "tunnel blue"],
    "evidence": [{
      "session_id": "session-one",
      "sequence": 0,
      "quote": "Do NOT expose port 8080."
    }, {
      "session_id": "session-two",
      "sequence": 0,
      "quote": "Use port 443 and tunnel blue."
    }]
  }]
}
```

```sh
cairn proposals consolidate --project /path/to/project --scope project \
  --session session-one --session session-two --input candidates.json --json
cairn proposals show DIGEST --project /path/to/project --json
# Only after explicit review of this exact proposal:
cairn proposals apply DIGEST --project /path/to/project --json
```

Consolidation itself makes no model/provider call. Every evidence quote must
occur in a string payload of the named event after current redaction. Every
`preserve` literal must remain unchanged in both evidence and proposed value.
Choose complete conditions and negations, not just convenient keywords. These
checks do not prove that a paraphrase follows logically from its evidence.
Input containing newly known secrets is refused rather than promoted.

The immutable v2 proposal records source session digests, per-candidate evidence,
literal requirements and `observed|asserted|hypothesis` status. The status is also
prefixed to the eventual ordinary-memory value so it survives normal retrieval.
Source text remains untouched. Existing single-session creation retains its v1
shape and existing provider behavior. Proposals can suggest a correction or a
consolidated value at an existing key; they never automatically delete other
keys, merge entities, rewrite originals or change freshness/sharing permissions.

Apply rechecks every selected trajectory and current redaction, then uses the
existing atomic reviewed-memory transaction to check all target base hashes
and write all candidates or none. Replays retain existing idempotence semantics.
Source checks are point-in-time: there is no transaction spanning trajectory
storage, several source files and the target memory database. Byte-identical
trajectory replacement is not detected as a distinct event/epoch. Pruned or
missing source trajectories prevent future application of their proposals.

## Storage, rollback and qualification

New records are local under `.agentfs/local-context/wiki-evidence/DIGEST.json`
and `.agentfs/local-context/continuations/DIGEST.json`; consolidation uses the
existing `.agentfs/memory-proposals/DIGEST.json` store. New files/directories use
the existing private mode/ACL primitives. Store ancestry must also prohibit
replacement by untrusted users; unsafe parents
are refused rather than automatically chmodded. Hard-link publication exposes a complete
immutable file without replacing another writer's digest; unsupported filesystems
fail closed. Each new record collection admits at most 1,024 files/64 MiB at
publication time, not a cross-process quota transaction. Interrupted temporary
remnants refuse further publication and require operator inspection.

Ordinary uninstall retains these private records. Generic memory export does not
include them: back up the private directories separately. Do not commit runtime
records. Creation, checking and display add no MCP tools, hooks, timers, background
jobs, subscriptions or database migrations. Discontinue use to roll back the
new observation features; normal reviewed-memory history/supersede workflows
apply to an explicitly promoted candidate. No automatic deletion is performed.

From a built source checkout, run:

```sh
npm --prefix mcp-memory-server run check:evidence-continuation
```

The offline synthetic rehearsal covers fresh processes and cwd changes, two
projects, literal preservation, stale evidence, untrusted paths and reviewed
promotion. It is a protocol/continuity check—not evidence of a quality win across
models, real harness UIs, machines or independent human users. Production remains
unchanged; no hosted native qualification or new video recording is implied.
