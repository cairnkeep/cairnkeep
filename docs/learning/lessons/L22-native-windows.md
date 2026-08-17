# L22 - Operate Cairnkeep on native Windows

**Status:** Ready
**Track:** Operator
**Time:** 30 minutes
**Tested with:** Cairnkeep 2.13.1, Windows x64, and Node.js 22 or newer

## Outcome

You can prove that Cairnkeep is running natively from PowerShell, run guided
setup on an empty path containing spaces, inspect its security boundary, and
perform a reversible uninstall without relying on WSL or Git Bash.

## Exercise

From PowerShell:

```powershell
npm install --global @cairnkeep/cli@2.13.1
cairn version

$Lab = Join-Path $env:TEMP 'Cairnkeep Windows Lab'
New-Item -ItemType Directory -Force -Path $Lab | Out-Null
cairn setup $Lab --git init --harness claude --memory local --yes
cairn sync --apply --live-root (Join-Path $Lab '.claude-test')
cairn sync --check --live-root (Join-Path $Lab '.claude-test')
Push-Location $Lab
cairn doctor
Pop-Location
```

Verify that `.git`, `.ai/cairnkeep.json`, `.ai/start-claude.cmd`,
`.ai/start-harness.ps1`, and the managed Claude assets exist. `cairn doctor`
must identify native Windows x64 and complete an MCP stdio handshake.

## Permission check

```powershell
Get-Acl (Join-Path $Lab '.ai\capabilities.json') | Format-List
```

Managed private files remove inherited broad access and retain only the current
identity, Local System, and Administrators. Do not replace this with a Unix-mode
check; Windows authorization is an ACL contract.

## Recovery exercise

```powershell
cairn uninstall --dry-run --live-root (Join-Path $Lab '.claude-test') $Lab
cairn uninstall --yes --live-root (Join-Path $Lab '.claude-test') $Lab
```

The command prints the timestamped backup location. Inspect `manifest.json` and
`revert.ps1`; run the revert script only if you intentionally want to restore
the removed managed assets.

## Common failures

| Symptom | Cause | Recovery |
|---|---|---|
| `cairn.cmd` is not found | npm's global directory is not on `PATH` | Run `npm prefix -g`, add the resulting directory to the user `PATH`, then open a new PowerShell session |
| Hook registration reports drift | Managed `.cmd` hook or settings entry is absent | Run `cairn sync --apply`, then repeat `cairn sync --check` |
| Memory export fails | `sqlite3.exe` is absent | Install SQLite and confirm `Get-Command sqlite3.exe`; runtime and import remain available |
| A private-state check fails | The file inherited a broader ACL | Preserve the file, inspect it with `Get-Acl`, and recreate it through the owning Cairnkeep command |

## Privacy and trust boundary

Native support changes process, path, and permission mechanics; it does not
enable a network, model, capture, artifact, context-pack, or capability flag.
The Windows ACL is a local-host access boundary, while pack digests establish
content integrity rather than publisher authenticity. Task Scheduler and purge
operations remain separate explicit actions.

## Boundaries

- Windows x64 is native; Windows ARM64 is currently x64 emulation.
- `sqlite3.exe` is optional for runtime and import, but required for a WAL-safe
  memory export.
- WSL is a separate Linux topology. Git Bash is not native-Windows evidence.
- Task Scheduler changes remain opt-in through `cairn audit-timer`.

See [Native Windows operation](../../native-windows.md) for the complete
platform contract.
