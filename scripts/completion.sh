#!/usr/bin/env bash
set -euo pipefail

shell=${1:-}

case "$shell" in
  bash)
    cat <<'EOF'
_cairn_complete() {
  local current previous commands
  COMPREPLY=()
  current=${COMP_WORDS[COMP_CWORD]}
  previous=${COMP_WORDS[COMP_CWORD-1]:-}
  commands="bootstrap memory-server sync sync-pi doctor trajectory artifact capabilities notes eval graph memory audit-timer uninstall completion version help"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W "$commands" -- "$current") )
    return
  fi
  case "${COMP_WORDS[1]}" in
    bootstrap) COMPREPLY=( $(compgen -W "--untracked" -- "$current") ) ;;
    sync) COMPREPLY=( $(compgen -W "--apply --live-root" -- "$current") ) ;;
    sync-pi) COMPREPLY=( $(compgen -W "--apply --live-root" -- "$current") ) ;;
    doctor) COMPREPLY=( $(compgen -W "--repair" -- "$current") ) ;;
    trajectory) COMPREPLY=( $(compgen -W "list show prune --json --dry-run" -- "$current") ) ;;
    artifact) COMPREPLY=( $(compgen -W "list show delete prune --kind --session --json --dry-run --include-protected" -- "$current") ) ;;
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
    graph) COMPREPLY=( $(compgen -W "build query status diff explain path --force" -- "$current") ) ;;
    memory) COMPREPLY=( $(compgen -W "path export import" -- "$current") ) ;;
    audit-timer) COMPREPLY=( $(compgen -W "--on-calendar --para-root --render-only" -- "$current") ) ;;
    uninstall) COMPREPLY=( $(compgen -W "--dry-run --yes --purge-memory --live-root --pi-live-root" -- "$current") ) ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "$current") ) ;;
  esac
}
complete -F _cairn_complete cairn
EOF
    ;;
  zsh)
    cat <<'EOF'
#compdef cairn
_cairn() {
  local -a commands
  commands=(
    'bootstrap:scaffold a project'
    'memory-server:run the memory MCP server'
    'sync:install the Claude operating layer'
    'sync-pi:install the Pi trajectory extension'
    'doctor:check runtime dependencies and endpoints'
    'trajectory:inspect and prune local session trajectories'
    'artifact:inspect, delete, and prune local artifacts'
    'capabilities:inspect and manage project capability state'
    'notes:distill and search local hindsight notes'
    'eval:run and inspect default-off local evaluations'
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
    sync) _arguments '--apply[apply changes]' '--live-root[project Claude root]:directory:_files -/' ;;
    sync-pi) _arguments '--apply[apply changes]' '--live-root[Pi agent root]:directory:_files -/' ;;
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
    graph) _values 'graph command' build query status diff explain path '--force[allow a smaller graph after code deletion]' ;;
    memory) _values 'memory command' path export import ;;
    audit-timer) _arguments '--on-calendar[systemd calendar]:calendar:' '--para-root[PARA root]:directory:_files -/' '--render-only[render directory]:directory:_files -/' ;;
    uninstall) _arguments '--dry-run[show changes]' '--yes[skip confirmation]' '--purge-memory[delete memory]' '--live-root[project Claude root]:directory:_files -/' '--pi-live-root[Pi agent root]:directory:_files -/' '*:project directory:_files -/' ;;
    completion) _values 'shell' bash zsh fish ;;
    *) _arguments '*:argument:_files' ;;
  esac
}
_cairn "$@"
EOF
    ;;
  fish)
    cat <<'EOF'
complete -c cairn -f
for command in bootstrap memory-server sync sync-pi doctor trajectory artifact capabilities notes eval graph memory audit-timer uninstall completion version help
    complete -c cairn -n "not __fish_seen_subcommand_from bootstrap memory-server sync sync-pi doctor trajectory artifact capabilities notes eval graph memory audit-timer uninstall completion version help" -a $command
end
complete -c cairn -n "__fish_seen_subcommand_from sync" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from bootstrap" -l untracked
complete -c cairn -n "__fish_seen_subcommand_from memory" -a "path export import"
complete -c cairn -n "__fish_seen_subcommand_from doctor" -l repair
complete -c cairn -n "__fish_seen_subcommand_from trajectory" -a "list show prune"
complete -c cairn -n "__fish_seen_subcommand_from artifact" -a "list show delete prune"
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list" -l kind -r
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list" -l session -r
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from list show delete prune" -l json
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from delete prune" -l dry-run
complete -c cairn -n "__fish_seen_subcommand_from artifact; and __fish_seen_subcommand_from prune" -l include-protected
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and not __fish_seen_subcommand_from list status enable disable reset logging" -a "list status enable disable reset logging"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from enable disable; and not __fish_seen_subcommand_from memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -a "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from reset; and not __fish_seen_subcommand_from memory.write memory.search notes.distill wiki graph security.audit route.check context.explore" -a "memory.write memory.search notes.distill wiki graph security.audit route.check context.explore"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from reset" -l all
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from logging; and not __fish_seen_subcommand_from enable disable reset" -a "enable disable reset"
complete -c cairn -n "__fish_seen_subcommand_from capabilities; and __fish_seen_subcommand_from list status enable disable reset logging" -l json
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
complete -c cairn -n "__fish_seen_subcommand_from graph" -a "build query status diff explain path"
complete -c cairn -n "__fish_seen_subcommand_from graph; and __fish_seen_subcommand_from build" -l force
complete -c cairn -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l pi-live-root -r
EOF
    ;;
  *)
    printf 'usage: cairn completion bash|zsh|fish\n' >&2
    exit 2
    ;;
esac
