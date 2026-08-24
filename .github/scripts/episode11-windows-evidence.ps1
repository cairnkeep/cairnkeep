$ErrorActionPreference = 'Stop'
$evidence = Join-Path $env:RUNNER_TEMP 'cairnkeep-windows-evidence'
$lab = Join-Path $env:RUNNER_TEMP 'Cairnkeep Course Windows Lab'
$liveRoot = Join-Path $env:RUNNER_TEMP 'Claude Course Root'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$transcript = Join-Path $evidence 'native-windows-transcript.txt'

function Record-Section([string] $title) {
  Add-Content -Path $transcript -Value "`n## $title`n"
}
function Record-Command([string] $command, [scriptblock] $action) {
  Add-Content -Path $transcript -Value "PS> $command"
  $global:LASTEXITCODE = 0
  $output = & $action 2>&1 | Out-String
  Add-Content -Path $transcript -Value $output.TrimEnd()
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit $LASTEXITCODE`: $command"
  }
}

Set-Content -Path $transcript -Value @(
  '# Cairnkeep native Windows learning-path evidence',
  '',
  'Environment: GitHub-hosted Windows x64 runner',
  'Purpose: disposable Episode 11 command rehearsal'
)

Record-Section 'Platform and installed package'
Record-Command '$PSVersionTable.PSVersion' { $PSVersionTable.PSVersion | Format-Table | Out-String }
Record-Command '[System.Runtime.InteropServices.RuntimeInformation]::OSDescription' { [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }
Record-Command '[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture' { [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture }
Record-Command 'node --version' { node --version }
Record-Command 'git --version' { git --version }
Record-Command 'cairn version' { cairn version }

Record-Section 'Guided setup in a path containing spaces'
Record-Command "cairn setup `$Lab --git init --harness 'claude,codex' --memory local --yes" {
  cairn setup $lab --git init --harness 'claude,codex' --memory local --yes
}
Record-Command 'git -C $Lab status --short --branch' { git -C $lab status --short --branch }
Record-Command 'Get-ChildItem $Lab -Force' { Get-ChildItem $lab -Force | Select-Object Name, Mode | Format-Table | Out-String }
Record-Command 'Get-ChildItem (Join-Path $Lab .ai)' { Get-ChildItem (Join-Path $lab '.ai') | Select-Object Name | Format-Table | Out-String }
Record-Command 'Get-Content (Join-Path $Lab .codex/config.toml)' { Get-Content (Join-Path $lab '.codex/config.toml') }

Record-Section 'Isolated Claude sync and local doctor'
Record-Command 'cairn sync --apply --live-root $LiveRoot' { cairn sync --apply --live-root $liveRoot }
Push-Location $lab
try {
  Record-Command 'cairn doctor' { cairn doctor }
} finally {
  Pop-Location
}

Record-Section 'Native Windows ACL'
Record-Command 'Get-Acl (Join-Path $Lab .ai/cairnkeep.json)' {
  Get-Acl (Join-Path $lab '.ai/cairnkeep.json') |
    Select-Object Owner, AreAccessRulesProtected, AccessToString |
    Format-List | Out-String
}

Record-Section 'Backup-first uninstall and recovery assets'
Record-Command 'cairn uninstall --dry-run --live-root $LiveRoot $Lab' {
  cairn uninstall --dry-run --live-root $liveRoot $lab
}
Record-Command 'cairn uninstall --yes --live-root $LiveRoot $Lab' {
  cairn uninstall --yes --live-root $liveRoot $lab
}
$backupRoot = Join-Path $HOME 'cairnkeep-uninstall-backups'
$backup = Get-ChildItem $backupRoot -Directory |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw 'Uninstall backup directory was not created' }
$manifest = Get-ChildItem $backup.FullName -Recurse -Filter 'manifest.json' | Select-Object -First 1
$revert = Get-ChildItem $backup.FullName -Recurse -Filter 'revert.ps1' | Select-Object -First 1
if (-not $manifest) { throw 'Uninstall manifest.json was not created' }
if (-not $revert) { throw 'Uninstall revert.ps1 was not created' }
Record-Command 'Get-ChildItem $Backup -Recurse' {
  Get-ChildItem $backup.FullName -Recurse | ForEach-Object {
    $_.FullName.Replace($backup.FullName, '<backup>')
  }
}
Record-Command 'Get-Content $Manifest' { Get-Content $manifest.FullName }
$digest = (Get-FileHash $transcript -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path (Join-Path $evidence 'native-windows-transcript.sha256') -Value "$digest  native-windows-transcript.txt"
