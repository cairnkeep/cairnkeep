#!/usr/bin/env bash
set -euo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
harnesses=$(node "$CAIRN_ROOT/scripts/harness-registry.mjs" ids)
shell=${1:-}

case "$shell" in
  bash)
    sed "s/__CAIRN_HARNESSES__/$harnesses/g" <<'EOF'
_cairn_complete() {
  local current previous commands
  COMPREPLY=()
  current=${COMP_WORDS[COMP_CWORD]}
  previous=${COMP_WORDS[COMP_CWORD-1]:-}
  commands="bootstrap setup memory-server sync sync-pi sync-kimi doctor trajectory artifact evidence capabilities mcp-tools pack notes eval skill graph memory audit-timer uninstall completion version help"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W "$commands" -- "$current") )
    return
  fi
  case "${COMP_WORDS[1]}" in
    bootstrap) COMPREPLY=( $(compgen -W "--untracked" -- "$current") ) ;;
    setup) COMPREPLY=( $(compgen -W "--git --harness --memory --policy --yes --json init existing none __CAIRN_HARNESSES__ local" -- "$current") ) ;;
    sync) COMPREPLY=( $(compgen -W "--apply --live-root" -- "$current") ) ;;
    sync-pi) COMPREPLY=( $(compgen -W "--apply --live-root" -- "$current") ) ;;
    sync-kimi) COMPREPLY=( $(compgen -W "--apply --live-root" -- "$current") ) ;;
    doctor) COMPREPLY=( $(compgen -W "--repair" -- "$current") ) ;;
    trajectory) COMPREPLY=( $(compgen -W "list show prune --json --dry-run" -- "$current") ) ;;
    artifact) COMPREPLY=( $(compgen -W "list show delete prune --kind --session --json --dry-run --include-protected" -- "$current") ) ;;
    evidence) COMPREPLY=( $(compgen -W "list show delete prune doctor --status --json --dry-run --repair" -- "$current") ) ;;
    capabilities)
      case "${COMP_WORDS[2]:-}" in
        enable|disable)
          if (( COMP_CWORD == 3 )); then
            COMPREPLY=( $(compgen -W "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -- "$current") )
          else
            COMPREPLY=( $(compgen -W "--json" -- "$current") )
          fi
          ;;
        reset)
          if (( COMP_CWORD == 3 )); then
            COMPREPLY=( $(compgen -W "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore --all" -- "$current") )
          else
            COMPREPLY=( $(compgen -W "--json" -- "$current") )
          fi
          ;;
        logging)
          if (( COMP_CWORD == 3 )); then
            COMPREPLY=( $(compgen -W "enable disable reset" -- "$current") )
          else
            COMPREPLY=( $(compgen -W "--json" -- "$current") )
          fi
          ;;
        list|status) COMPREPLY=( $(compgen -W "--json" -- "$current") ) ;;
        *) COMPREPLY=( $(compgen -W "list status enable disable reset logging" -- "$current") ) ;;
      esac
      ;;
    mcp-tools) COMPREPLY=( $(compgen -W "list status set reset full read-only custom --tool --project --json" -- "$current") ) ;;
    pack) COMPREPLY=( $(compgen -W "init lock validate install list show remove enable disable update skills approve-skill revoke-skill --id --version --title --description --license --ref --project --project-id --check --apply --confirm --json" -- "$current") ) ;;
    notes) COMPREPLY=( $(compgen -W "distill search-error promote doctor --project --session --all-projects --para-root --text --component --with --confirm --repair --json" -- "$current") ) ;;
    eval)
      case "${COMP_WORDS[2]:-}" in
        validate) COMPREPLY=( $(compgen -W "--task-set --adapter --output --repetitions --seed --json" -- "$current") ) ;;
        run) COMPREPLY=( $(compgen -W "--task-set --adapter --output --repetitions --seed --yes --json" -- "$current") ) ;;
        ablate) COMPREPLY=( $(compgen -W "--disable --task-set --adapter --output --repetitions --seed --yes --json memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -- "$current") ) ;;
        report) COMPREPLY=( $(compgen -W "--experiment --json" -- "$current") ) ;;
        prune) COMPREPLY=( $(compgen -W "--older-than-days --dry-run --json" -- "$current") ) ;;
        delete) COMPREPLY=( $(compgen -W "--experiment --dry-run --json" -- "$current") ) ;;
        *) COMPREPLY=( $(compgen -W "validate run ablate report prune delete" -- "$current") ) ;;
      esac
      ;;
    skill) COMPREPLY=( $(compgen -W "harvest list show review propose evaluate apply rollback --project --minimum-occurrences --kind --id --candidate --approve --target --adapter --edit-budget --proposal --exploration-task-set --confirmation-task-set --output --repetitions --seed --minimum-improvement --evaluation --application --confirm --yes --json" -- "$current") ) ;;
    graph) COMPREPLY=( $(compgen -W "build query status diff explain path --force" -- "$current") ) ;;
    memory) COMPREPLY=( $(compgen -W "path export import" -- "$current") ) ;;
    audit-timer) COMPREPLY=( $(compgen -W "--on-calendar --para-root --render-only" -- "$current") ) ;;
    uninstall) COMPREPLY=( $(compgen -W "--dry-run --yes --purge-memory --purge-packs --live-root --pi-live-root --kimi-live-root" -- "$current") ) ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "$current") ) ;;
  esac
}
complete -F _cairn_complete cairn
EOF
    ;;
  zsh)
    sed "s/__CAIRN_HARNESSES__/$harnesses/g" <<'EOF'
#compdef cairn
_cairn() {
  local -a commands
  commands=(
    'bootstrap:scaffold a project'
    'setup:configure selected project harnesses'
    'memory-server:run the memory MCP server'
    'sync:install the Claude operating layer'
    'sync-pi:install the Pi trajectory extension and graph prompt'
    'sync-kimi:install the Kimi graph Skill'
    'doctor:check runtime dependencies and endpoints'
    'trajectory:inspect and prune local session trajectories'
    'artifact:inspect, delete, and prune local artifacts'
    'evidence:inspect and manage local Git-linked work evidence'
    'capabilities:inspect and manage project capability state'
    'mcp-tools:inspect and restrict MCP tool exposure'
    'pack:manage immutable context packs and skill approvals'
    'notes:distill and search local hindsight notes'
    'eval:run and inspect default-off local evaluations'
    'skill:review and evaluate evidence-backed skill improvements'
    'graph:inspect a published Graphify graph'
    'memory:manage the durable memory store'
    'audit-timer:install a memory and wiki audit timer'
    'uninstall:remove installed Cairnkeep components safely'
    'completion:generate shell completion'
    'version:show the installed version'
    'help:show help'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case $words[2] in
    bootstrap) _arguments '--untracked[keep scaffold out of Git]' '*:project directory:_files -/' ;;
    setup) _arguments '*:project directory:_files -/' '--git[Git mode]:mode:(init existing none)' '--harness[selected harnesses]:harnesses:(__CAIRN_HARNESSES__)' '--memory[memory mode]:mode:(local none)' '--policy[setup policy]:file:_files' '--yes[confirm setup]' '--json[emit JSON]' ;;
    sync) _arguments '--apply[apply changes]' '--live-root[project Claude root]:directory:_files -/' ;;
    sync-pi) _arguments '--apply[apply changes]' '--live-root[Pi agent root]:directory:_files -/' ;;
    sync-kimi) _arguments '--apply[apply changes]' '--live-root[Kimi Code root]:directory:_files -/' ;;
    doctor) _arguments '--repair[repair trajectory metadata and indexes]' ;;
    trajectory) _values 'trajectory command' list show prune ;;
    artifact)
      case $words[3] in
        list) _arguments '--kind[filter by exact artifact kind]:kind:(compaction_summary diff test_output generated_file)' '--session[filter by exact session reference]:session:' '--json[emit JSON]' ;;
        show) _arguments '1:artifact ID or prefix:' '--json[emit JSON]' ;;
        delete) _arguments '1:artifact ID or prefix:' '--dry-run[report without deleting]' '--json[emit JSON]' ;;
        prune) _arguments '--dry-run[report without pruning]' '--include-protected[allow removal of the newest valid project compaction]' '--json[emit JSON]' ;;
        *) _values 'artifact command' list show delete prune ;;
      esac
      ;;
    evidence) _values 'work evidence command' list show delete prune doctor '--status[filter records]:status:(pending complete)' '--dry-run[report without mutation]' '--repair[remove safe temporary remnants]' '--json[emit JSON]' ;;
    mcp-tools) _values 'MCP tool profile command' list status set reset full read-only custom '--tool[allow an exact tool]:tool:' '--project[project root]:directory:_files -/' '--json[emit JSON]' ;;
    pack) _values 'context pack command' init lock validate install list show remove enable disable update skills approve-skill revoke-skill '--ref[pinned Git ref]:ref:' '--project[project root]:directory:_files -/' '--project-id[remote project ID]:project ID:' '--check[inspect update]' '--apply[apply update]' '--confirm[confirm digest]:digest:' '--json[emit JSON]' ;;
    capabilities)
      case $words[3] in
        list|status) _arguments '--json[emit JSON]' ;;
        enable|disable) _arguments '1:capability ID:(memory.write memory.search notes.distill wiki graph security.audit route.check context.explore)' '--json[emit JSON]' ;;
        reset) _arguments '1:capability ID:(memory.write memory.search notes.distill wiki graph security.audit route.check context.explore)' '--all[reset every override]' '--json[emit JSON]' ;;
        logging) _values 'logging operation' enable disable reset '--json[emit JSON]' ;;
        *) _values 'capability command' list status enable disable reset logging ;;
      esac
      ;;
    notes) _values 'notes command' distill search-error promote doctor ;;
    eval)
      case $words[3] in
        validate) _arguments '--task-set[task-set manifest]:file:_files' '--adapter[adapter configuration]:file:_files' '--output[local output root]:directory:_files -/' '--repetitions[repetition count]:count:' '--seed[deterministic seed]:seed:' '--json[emit JSON]' ;;
        run) _arguments '--task-set[task-set manifest]:file:_files' '--adapter[adapter configuration]:file:_files' '--output[local output root]:directory:_files -/' '--repetitions[repetition count]:count:' '--seed[deterministic seed]:seed:' '--yes[confirm execution]' '--json[emit JSON]' ;;
        ablate) _arguments '--disable[capability to disable]:capability ID:(memory.write memory.search notes.distill wiki graph security.audit route.check context.explore)' '--task-set[task-set manifest]:file:_files' '--adapter[adapter configuration]:file:_files' '--output[local output root]:directory:_files -/' '--repetitions[repetition count]:count:' '--seed[deterministic seed]:seed:' '--yes[confirm execution]' '--json[emit JSON]' ;;
        report) _arguments '--experiment[experiment ID]:experiment ID:' '--json[emit JSON]' ;;
        prune) _arguments '--older-than-days[retention age]:days:' '--dry-run[report without pruning]' '--json[emit JSON]' ;;
        delete) _arguments '--experiment[experiment ID]:experiment ID:' '--dry-run[report without deleting]' '--json[emit JSON]' ;;
        *) _values 'eval command' validate run ablate report prune delete ;;
      esac
      ;;
    skill)
      case $words[3] in
        harvest) _arguments '--project[project root]:directory:_files -/' '--minimum-occurrences[minimum recurring failures]:count:' '--json[emit JSON]' ;;
        list) _arguments '--project[project root]:directory:_files -/' '--kind[artifact kind]:kind:(candidate proposal evaluation application)' '--json[emit JSON]' ;;
        show) _arguments '--project[project root]:directory:_files -/' '--kind[artifact kind]:kind:(candidate proposal evaluation application)' '--id[artifact ID]:artifact ID:' '--json[emit JSON]' ;;
        review) _arguments '--project[project root]:directory:_files -/' '--candidate[candidate ID]:candidate ID:' '--approve[approve evidence]' '--json[emit JSON]' ;;
        propose) _arguments '--project[project root]:directory:_files -/' '--candidate[candidate ID]:candidate ID:' '--target[existing SKILL.md]:file:_files' '--adapter[proposal adapter configuration]:file:_files' '--edit-budget[maximum edits]:count:' '--json[emit JSON]' ;;
        evaluate) _arguments '--project[project root]:directory:_files -/' '--proposal[proposal ID]:proposal ID:' '--exploration-task-set[exploration task set]:file:_files' '--confirmation-task-set[confirmation task set]:file:_files' '--adapter[evaluation adapter configuration]:file:_files' '--output[report root]:directory:_files -/' '--repetitions[repetition count]:count:' '--seed[deterministic seed]:seed:' '--minimum-improvement[distinct improved tasks]:count:' '--yes[confirm execution]' '--json[emit JSON]' ;;
        apply) _arguments '--project[project root]:directory:_files -/' '--proposal[proposal ID]:proposal ID:' '--evaluation[evaluation ID]:evaluation ID:' '--confirm[exact proposal digest]:digest:' '--json[emit JSON]' ;;
        rollback) _arguments '--project[project root]:directory:_files -/' '--application[application ID]:application ID:' '--confirm[confirm rollback]' '--json[emit JSON]' ;;
        *) _values 'skill command' harvest list show review propose evaluate apply rollback ;;
      esac
      ;;
    graph) _values 'graph command' build query status diff explain path '--force[allow a smaller graph after code deletion]' ;;
    memory) _values 'memory command' path export import ;;
    audit-timer) _arguments '--on-calendar[systemd calendar]:calendar:' '--para-root[PARA root]:directory:_files -/' '--render-only[render directory]:directory:_files -/' ;;
    uninstall) _arguments '--dry-run[show changes]' '--yes[skip confirmation]' '--purge-memory[delete memory]' '--purge-packs[delete context packs]' '--live-root[project Claude root]:directory:_files -/' '--pi-live-root[Pi agent root]:directory:_files -/' '--kimi-live-root[Kimi Code root]:directory:_files -/' '*:project directory:_files -/' ;;
    completion) _values 'shell' bash zsh fish ;;
    *) _arguments '*:argument:_files' ;;
  esac
}
_cairn "$@"
EOF
    ;;
  fish)
    sed "s/__CAIRN_HARNESSES__/$harnesses/g" <<'EOF'
complete -c cairn -f
for command in bootstrap setup memory-server sync sync-pi sync-kimi doctor trajectory artifact evidence capabilities mcp-tools pack notes eval skill graph memory audit-timer uninstall completion version help
    complete -c cairn -n "not __fish_seen_subcommand_from bootstrap setup memory-server sync sync-pi sync-kimi doctor trajectory artifact evidence capabilities mcp-tools pack notes eval skill graph memory audit-timer uninstall completion version help" -a $command
end
complete -c cairn -n "__fish_seen_subcommand_from sync" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from sync-kimi" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync-kimi" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from bootstrap" -l untracked
complete -c cairn -n "__fish_seen_subcommand_from setup" -l git -r -a "init existing none"
complete -c cairn -n "__fish_seen_subcommand_from setup" -l harness -r -a "__CAIRN_HARNESSES__"
complete -c cairn -n "__fish_seen_subcommand_from setup" -l memory -r -a "local none"
complete -c cairn -n "__fish_seen_subcommand_from setup" -l policy -r
complete -c cairn -n "__fish_seen_subcommand_from setup" -l yes
complete -c cairn -n "__fish_seen_subcommand_from setup" -l json
complete -c cairn -n "__fish_seen_subcommand_from memory" -a "path export import"
complete -c cairn -n "__fish_seen_subcommand_from doctor" -l repair
complete -c cairn -n "__fish_seen_subcommand_from trajectory" -a "list show prune"
complete -c cairn -n "__fish_seen_subcommand_from artifact" -a "list show delete prune"
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list" -l kind -r
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list" -l session -r
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list show delete prune" -l json
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from delete prune" -l dry-run
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from prune" -l include-protected
complete -c cairn -n "__fish_seen_subcommand_from evidence" -a "list show delete prune doctor"
complete -c cairn -n "__fish_seen_subcommand_from evidence; and __fish_seen_subcommand_from list" -l status -r -a "pending complete"
complete -c cairn -n "__fish_seen_subcommand_from evidence; and __fish_seen_subcommand_from list show delete prune doctor" -l json
complete -c cairn -n "__fish_seen_subcommand_from evidence; and __fish_seen_subcommand_from delete prune" -l dry-run
complete -c cairn -n "__fish_seen_subcommand_from evidence; and __fish_seen_subcommand_from doctor" -l repair
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and not __fish_seen_subcommand_from list status enable disable reset logging" -a "list status enable disable reset logging"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from enable disable; and not __fish_seen_subcommand_from memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -a "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from reset; and not __fish_seen_subcommand_from memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -a "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from reset" -l all
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from logging; and not __fish_seen_subcommand_from enable disable reset" -a "enable disable reset"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from list status enable disable reset logging" -l json
complete -c cairn -n "__fish_seen_subcommand_from mcp-tools" -a "list status set reset"
complete -c cairn -n "__fish_seen_subcommand_from mcp-tools; and __fish_seen_subcommand_from set" -a "full read-only custom"
complete -c cairn -n "__fish_seen_subcommand_from mcp-tools" -l project -r
complete -c cairn -n "__fish_seen_subcommand_from mcp-tools" -l tool -r
complete -c cairn -n "__fish_seen_subcommand_from mcp-tools" -l json
complete -c cairn -n "__fish_seen_subcommand_from pack" -a "init lock validate install list show remove enable disable update skills approve-skill revoke-skill"
complete -c cairn -n "__fish_seen_subcommand_from pack" -l project -r
complete -c cairn -n "__fish_seen_subcommand_from pack" -l project-id -r
complete -c cairn -n "__fish_seen_subcommand_from pack" -l ref -r
complete -c cairn -n "__fish_seen_subcommand_from pack" -l confirm -r
complete -c cairn -n "__fish_seen_subcommand_from pack" -l json
complete -c cairn -n "__fish_seen_subcommand_from notes" -a "distill search-error promote doctor"
complete -c cairn -n "__fish_seen_subcommand_from eval; and not __fish_seen_subcommand_from validate run ablate report prune delete" -a "validate run ablate report prune delete"
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate" -l task-set -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate" -l adapter -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate" -l output -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate" -l repetitions -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate" -l seed -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from run ablate" -l yes
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from ablate" -l disable -r -a "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore"
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from report delete" -l experiment -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from prune" -l older-than-days -r
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from prune delete" -l dry-run
complete -c cairn -n "__fish_seen_subcommand_from eval; and __fish_seen_subcommand_from validate run ablate report prune delete" -l json
complete -c cairn -n "__fish_seen_subcommand_from skill; and not __fish_seen_subcommand_from harvest list show review propose evaluate apply rollback" -a "harvest list show review propose evaluate apply rollback"
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from harvest list show review propose evaluate apply rollback" -l project -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from harvest list show review propose evaluate apply rollback" -l json
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from harvest" -l minimum-occurrences -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from list show" -l kind -r -a "candidate proposal evaluation application"
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from show" -l id -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from review propose" -l candidate -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from review" -l approve
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from propose" -l target -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from propose evaluate" -l adapter -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from propose" -l edit-budget -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate apply" -l proposal -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l exploration-task-set -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l confirmation-task-set -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l output -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l repetitions -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l seed -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l minimum-improvement -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from evaluate" -l yes
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from apply" -l evaluation -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from apply" -l confirm -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from rollback" -l application -r
complete -c cairn -n "__fish_seen_subcommand_from skill; and __fish_seen_subcommand_from rollback" -l confirm
complete -c cairn -n "__fish_seen_subcommand_from graph" -a "build query status diff explain path"
complete -c cairn -n "__fish_seen_subcommand_from graph; and __fish_seen_subcommand_from build" -l force
complete -c cairn -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l pi-live-root -r
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l kimi-live-root -r
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l purge-memory
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l purge-packs
EOF
    ;;
  *)
    printf 'usage: cairn completion bash|zsh|fish\n' >&2
    exit 2
    ;;
esac
