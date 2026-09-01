# Native Windows operation

Cairnkeep supports Windows x64 directly from PowerShell and Command Prompt.
The supported path does not invoke WSL, Git Bash, or a POSIX shell. Windows
ARM64 may use Windows x64 emulation, but it is not a native ARM64 support claim
until the database dependency publishes and passes an ARM64 Windows binding.

## Install and guided setup

Prerequisites are Node.js 22 or newer, npm, and the harness you intend to use.
Git is required for `--git init`, `--git existing`, Git-backed context packs,
and `--untracked` bootstrap. Explicit `--git none` provides the same documented
limited mode as POSIX setup.
The optional `sqlite3.exe` command enables WAL-safe `cairn memory export`.

From an interactive PowerShell or Command Prompt, `cairn setup $Project`
presents native arrow-key Git and memory selectors plus a Space-toggle harness
checklist. The explicit form below remains preferable for scripts and fleet
automation:

```powershell
npm install --global @cairnkeep/cli
cairn version
$Project = 'C:\src\my-project'
cairn setup $Project --git init --harness claude,pi --memory local --yes
cairn sync --apply
cairn sync-pi --apply
cairn sync-pi --check
Set-Location $Project
cairn doctor
.\.ai\start-claude.cmd
```

Guided setup exposes the same target classification, confirmation, Git,
harness, memory, reconciliation, counts, JSON result, diagnostics, launch, and
recovery contract as POSIX. It writes a restricted `.ai/cairnkeep.json` setup
record and never syncs machine assets automatically. `cairn bootstrap` remains
the deterministic compatibility primitive for existing scripts.

Setup also writes private `.ai/playbooks.json` and reconciles Cairnkeep's
delimited workflow block in `AGENTS.md` without replacing surrounding rules.
The Node-native `cairn playbook` lifecycle, deterministic enforcement, private
receipts, and instruction management are identical on Windows and POSIX.

For Codex memory without a harness-wide sync, select only Codex:

```powershell
cairn setup $Project --git init --harness codex --memory local --yes
Set-Location $Project
cairn doctor
.\.ai\start-codex.cmd
```

Review `.codex\config.toml` and accept Codex's project-trust prompt. Setup does
not edit the user-wide Codex configuration or grant trust. It preserves a
different existing project configuration and doctor verifies a manually merged
`mcp_servers.cairn-memory-local` table.

Setup and bootstrap write both the established Unix launchers and native Windows
launchers. Each `.cmd` file enters `start-harness.ps1`, loads `.ai/.env`, changes
to the project root, and forwards arguments without shell interpolation.
Optional `.ai/pre-launch.ps1` and `.ai/post-exit.ps1` seams run in the same
PowerShell process, so exported environment changes reach the harness. The post
hook receives `$env:CAIRN_EXIT_STATUS`.

With `CAIRN_WORK_EVIDENCE=1`, the native PowerShell launcher routes all selected
harnesses through `cairn evidence run`. It uses the system `git.exe`, writes the
same private project-local format as POSIX systems, and preserves the harness
exit status. Missing Git, a non-repository directory or capture failure warns
and launches the harness directly. Optional patch capture additionally requires
`CAIRN_WORK_EVIDENCE_PATCH=1` and `CAIRN_ARTIFACT_STORE=1`; Windows atomic
replacement uses the platform file-replace primitive rather than POSIX rename
semantics.

## MCP and operating assets

Register the stdio server exactly as on other platforms:

```powershell
claude mcp add cairn-memory -s user -- cairn memory-server
cairn sync --check
```

`cairn sync --apply` installs native `.cmd` hook transports and registers them
in the harness settings. The hook logic itself is Node and remains fail-open
except for capability admission, which preserves its fail-closed contract.
`cairn sync-pi` and `cairn sync-kimi` use native filesystem operations. Pi sync
installs the maintained local stdio memory extension explicitly; setup does not
start it or add remote access. Pi 0.84.1 is the validated minimum; the v2.11
release matrix also exercised a separate installation of the exact
registry-current Pi release. The two executable paths were distinct, while
both reported 0.84.1 because that was also the current release.

## PowerShell completion

Load completion for the current session:

```powershell
Invoke-Expression (& cairn completion powershell | Out-String)
```

The completer includes playbook profiles, lifecycle events, canonical actions,
and check/record options as well as the top-level command.

Place the same expression in `$PROFILE` to load it in future sessions.

## Storage and permissions

Cairnkeep retains the same storage paths and formats. `~` resolves to the
Windows user profile. Sensitive managed JSON files do not rely on meaningless
Unix mode bits: Cairnkeep removes inherited ACLs and grants access only to the
current SID, Local System, and built-in Administrators. Context-pack content is
digest-verified before receiving restricted ACLs and a read-only attribute.
The guided setup state uses this same private ACL and contains no credentials,
endpoints, or absolute paths.

The embedded AgentFS database driver retains Windows file handles until its
Node process exits. Cairnkeep therefore runs artifact-store operations in
short-lived local Node helpers on Windows. Hard deletion and pruning build a
compacted replacement, release all handles when the helper exits, and only then
atomically replace the live database. This does not add a daemon, network
access, or background synchronization.

`cairn memory import` uses an internal path-validating tar/gzip reader. Export
uses `sqlite3.exe` `.backup` for a consistent snapshot of each live WAL database
and then writes the same portable `.tgz` format used on Unix.

## Scheduling and process cleanup

`cairn audit-timer` registers the opt-in `Cairnkeep Memory Audit` task through
Windows Task Scheduler. `--render-only DIR` writes the command without changing
the scheduler. Evaluation cancellation targets the exact child PID and its
descendant tree through `taskkill.exe /T`, then escalates through `/F` after the
configured grace period.

## Uninstall and recovery

Preview first, then confirm explicitly:

```powershell
cairn uninstall --dry-run C:\src\my-project
cairn uninstall --yes C:\src\my-project
```

Uninstall removes only managed assets and their hook registrations. Before
mutation it creates a timestamped bundle under
`~/cairnkeep-uninstall-backups/` containing exact files, a strict manifest, and
`revert.ps1`. Durable memory and context packs remain unless their separate
purge flags are supplied.

Uninstall removes only Cairnkeep's managed `AGENTS.md` block and preserves
surrounding project instructions. Pi and Kimi playbook adapters are handled as
precisely owned paths alongside their graph adapters.

## Verification boundary

The release gate runs from `windows-latest` using PowerShell for Node 22, 24,
and 26. It builds the TypeScript server, runs its Node tests, exercises guided
setup and bootstrap, sync/check (including Pi), native hooks, safe archive
import, backup-first uninstall, spaces and Unicode paths, packs the npm artifact,
installs it globally, invokes `cairn.cmd`, and runs `cairn doctor`. Git Bash is
never selected as the job shell.
