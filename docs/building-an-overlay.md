# Building a private overlay

Cairnkeep is deliberately provider-neutral: it hardcodes no endpoints, no
credentials, and no organization-specific launchers. Everything specific to
*your* environment — internal LLM endpoints, proxies, credentials, corporate
launchers, policy — belongs in a small private **overlay** that wraps cairnkeep.
This guide shows the pattern.

For multi-machine or organization-wide use, package the overlay as a managed
distribution that owns the enrolled machine's `cairn` command. See
[Managed Cairnkeep distributions](overlay-distributions.md) for the command,
manifest, profile-lock, private-registry, and rollback contract.

## Principles

1. **Consume, don't fork.** Treat cairnkeep as an upstream dependency: install it
   from npm (`npm i -g @cairnkeep/cli`) or clone it at a **pinned tag**. Never copy or
   patch core files — if core behaviour must change, request it upstream. That way
   you pick up fixes by bumping one version.
2. **One-way references.** Your overlay may reference cairnkeep freely. Nothing
   private — internal hosts, IPs, tokens, employer/vendor names — should ever end
   up *in cairnkeep* (in code, docs, or commit messages). Keep those in your
   overlay only, and keep secrets in untracked `.env` files or a secret store,
   never committed.
3. **Wrap at the seams, don't reimplement.** Cairnkeep's launchers and tools
   expose extension points (below). Use them instead of replacing core behaviour.

## The launcher seams

The generic launchers (`.ai/start-claude.sh`, `.ai/start-opencode.sh`, scaffolded
by `cairn bootstrap`) run three optional hooks, each a no-op when absent:

| Seam | When | Use it for |
|---|---|---|
| `.ai/pre-launch.sh` | sourced after `.env`, before launch | export a provider base URL / credentials, refresh a token, run a connectivity check, or **abort** the launch by returning non-zero |
| `CAIRN_EXTRA_SETTINGS` | read just before launch | path to a settings file layered onto the harness (`--settings` for Claude Code, `--config` for OpenCode); process env still wins, so an inline value beats the file |
| `.ai/post-exit.sh` | sourced after the harness exits | teardown; `CAIRN_EXIT_STATUS` holds the exit code |

**Typical overlay launcher** — a corporate wrapper needs a non-default provider
plus a credential refresh. Instead of forking the launcher, drop a
`.ai/pre-launch.sh`:

```bash
# .ai/pre-launch.sh  (sourced by the generic launcher)
# 1. refresh whatever credential your provider needs
./.ai/refresh-credentials.sh || return 1        # non-zero aborts the launch
# 2. render your provider settings and hand them to the harness
envsubst < ./.ai/provider-settings.json.template > /tmp/provider.$$.json
export CAIRN_EXTRA_SETTINGS=/tmp/provider.$$.json
export ANTHROPIC_BASE_URL="$MY_INTERNAL_GATEWAY"
```

The user still runs the standard `./.ai/start-claude.sh`; the overlay's behaviour
is injected by the file's presence.

## An overlay install script

Make it one idempotent command from a fresh machine:

```bash
# 1. Get cairnkeep at a pinned version (npm or a pinned clone)
npm i -g @cairnkeep/cli@1.0.2      # or: git clone … && git checkout v1.0.2

# 2. Register the memory server with your harness
claude mcp add cairn-memory -s user -- cairn memory-server

# 3. Scaffold the target project (contributor mode if you don't own the repo)
cairn bootstrap --untracked /path/to/project

# 4. Install the operating layer — GLOBAL or PROJECT-SCOPED (below)
sync-claude-assets.sh --apply                      # global ~/.claude
# or keep it to one project:
sync-claude-assets.sh --apply --live-root /path/to/project/.claude

# 5. Drop your corporate launcher/helpers/.env template into /path/to/project/.ai/
```

### Global vs project-scoped operating layer

`sync-claude-assets.sh` installs commands/agents/hooks into `~/.claude` by default
(global — affects every project). To onboard a single project **without** touching
global config or other projects, install into that project's `.claude/` with
`--live-root <project>/.claude`; the project's local assets take precedence there
while the rest of the machine is untouched.

### Contributor mode

If you don't own the target repo, `cairn bootstrap --untracked` writes the
scaffold paths into the repo's `.git/info/exclude` — nothing to commit, invisible
to other contributors, no edit to the shared `.gitignore`. To move the durable
memory itself between machines, use `cairn memory export` / `cairn memory import`.

## Isolating your memory server

If your overlay runs its own memory server and you don't want a globally-registered
one bleeding in, launch the harness with `--strict-mcp-config --mcp-config
.ai/mcp.json`, listing only the servers you want. A launcher that adds these flags
when `.ai/mcp.json` is present gives you per-project MCP isolation.

## Wiring the optional integrations

All optional, all env-gated — a wrapper turns them on by setting the env:

| Integration | Turn on with | See |
|---|---|---|
| Memory extraction / semantic search | `CAIRN_LLM_API_KEY` + `CAIRN_LLM_API_URL` (+ embedding vars) | [operating.md](operating.md) |
| Document RAG (`domain_knowledge_*`) | `ANYTHINGLLM_API_KEY` (+ `ANYTHINGLLM_BASE_URL`, `CAIRN_ANYTHINGLLM_SYNC_SCRIPT`) | [domain-knowledge.md](domain-knowledge.md) |
| Routing seam (`route_check`) | `CAIRN_ROUTE_ENDPOINT` | [operating.md](operating.md) |
| Context exploration (`context_explore`) | `CAIRN_EXPLORE_BINARY` (+ `CAIRN_EXPLORE_REPO_ROOT`) | [operating.md](operating.md) |
| Networked memory (HTTP transport) | `MCP_HTTP_PORT` + `CAIRN_MEMORY_HTTP_TOKEN` | [operating.md](operating.md) |

Point the RAG sync script at your own copy (`CAIRN_ANYTHINGLLM_SYNC_SCRIPT`) so the
integration scripts live in your overlay, not the core.

For a fleet that shares one trusted HTTP service, have the overlay generate
project-local Claude Code and OpenCode MCP entries with `X-Cairn-Project`,
`X-Cairn-Scopes`, and `X-Cairn-AnythingLLM-Workspaces`. This preserves local
project isolation and workspace defaults while keeping the databases and RAG
credentials on the server host. Keep bearer tokens in environment-backed
secret storage, not generated project files.

## Checklist

- [ ] cairnkeep pinned to a version; no core files copied or patched
- [ ] All internal hosts/tokens in untracked `.env` / secret store, never committed
- [ ] Provider/credential setup in `.ai/pre-launch.sh`, not a forked launcher
- [ ] Operating layer scoped as intended (global vs `--live-root`)
- [ ] Optional integrations wired only where wanted
- [ ] A single documented command takes a fresh machine to a working setup
- [ ] Managed machines resolve `cairn` to the overlay distribution, not raw core
- [ ] `cairn config explain` reports memory and RAG destinations without secrets
- [ ] A project profile lock prevents silent cross-overlay reconfiguration
- [ ] Private packages reject public-registry publication and exclude runtime data
