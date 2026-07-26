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
  commands="bootstrap memory-server sync sync-pi doctor trajectory memory audit-timer uninstall completion version help"
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
for command in bootstrap memory-server sync sync-pi doctor trajectory memory audit-timer uninstall completion version help
    complete -c cairn -n "not __fish_seen_subcommand_from bootstrap memory-server sync sync-pi doctor trajectory memory audit-timer uninstall completion version help" -a $command
end
complete -c cairn -n "__fish_seen_subcommand_from sync" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l apply
complete -c cairn -n "__fish_seen_subcommand_from sync-pi" -l live-root -r
complete -c cairn -n "__fish_seen_subcommand_from bootstrap" -l untracked
complete -c cairn -n "__fish_seen_subcommand_from memory" -a "path export import"
complete -c cairn -n "__fish_seen_subcommand_from doctor" -l repair
complete -c cairn -n "__fish_seen_subcommand_from trajectory" -a "list show prune"
complete -c cairn -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
complete -c cairn -n "__fish_seen_subcommand_from uninstall" -l pi-live-root -r
EOF
    ;;
  *)
    printf 'usage: cairn completion bash|zsh|fish\n' >&2
    exit 2
    ;;
esac
