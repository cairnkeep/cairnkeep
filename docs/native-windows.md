# Native Windows operation

Cairnkeep supports Windows x64 directly from PowerShell and Command Prompt.
The supported path does not invoke WSL, Git Bash, or a POSIX shell. Windows
ARM64 may use Windows x64 emulation, but it is not a native ARM64 support claim
until the database dependency publishes and passes an ARM64 Windows binding.

## Install and bootstrap

Prerequisites are Node.js 22 or newer, npm, and the harness you intend to use.
Git is needed only for Git-backed context packs and `--untracked` bootstrap.
The optional `sqlite3.exe` command enables WAL-safe `cairn memory export`.

```powershell
npm install --global @cairnkeep/cli
cairn version
cairn sync --apply

$Project = 'C:\src\my-project'
cairn bootstrap $Project
Set-Location $Project
cairn doctor
.\.ai\start-claude.cmd
```

Bootstrap writes both the established Unix launchers and native Windows
launchers. Each `.cmd` file enters `start-harness.ps1`, loads `.ai/.env`, changes
to the project root, and forwards arguments without shell interpolation.
Optional `.ai/pre-launch.ps1` and `.ai/post-exit.ps1` seams run in the same
PowerShell process, so exported environment changes reach the harness. The post
hook receives `$env:CAIRN_EXIT_STATUS`.

## MCP and operating assets

Register the stdio server exactly as on other platforms:

```powershell
claude mcp add cairn-memory -s user -- cairn memory-server
cairn sync --check
```

`cairn sync --apply` installs native `.cmd` hook transports and registers them
in the harness settings. The hook logic itself is Node and remains fail-open
except for capability admission, which preserves its fail-closed contract.
`cairn sync-pi` and `cairn sync-kimi` use native filesystem operations.

## PowerShell completion

Load completion for the current session:

```powershell
Invoke-Expression (& cairn completion powershell | Out-String)
```

Place the same expression in `$PROFILE` to load it in future sessions.

## Storage and permissions

Cairnkeep retains the same storage paths and formats. `~` resolves to the
Windows user profile. Sensitive managed JSON files do not rely on meaningless
Unix mode bits: Cairnkeep removes inherited ACLs and grants access only to the
current SID, Local System, and built-in Administrators. Context-pack content is
digest-verified before receiving restricted ACLs and a read-only attribute.

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

## Verification boundary

The release gate runs from `windows-latest` using PowerShell for Node 22, 24,
and 26. It builds the TypeScript server, runs its Node tests, exercises bootstrap,
sync/check, native hooks, safe archive import, backup-first uninstall, spaces and
Unicode paths, packs the npm artifact, installs it globally, invokes `cairn.cmd`,
and runs `cairn doctor`. Git Bash is never selected as the job shell.
