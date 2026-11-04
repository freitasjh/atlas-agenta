#!/usr/bin/env bash
#
# dev-down.sh — encerra APENAS o que o `scripts/dev-up.sh` subiu.
#
# - lê os PIDs de /tmp/atlas-dev (functions e frontend)
# - confere o dono (cwd = raiz do repo + cmdline esperada) antes de matar
# - NUNCA usa `pkill -f` e nunca derruba processo de outro projeto
# - remove o container do edge runtime DESTE projeto, se ainda existir
#
# Uso:
#   bash scripts/dev-down.sh          # functions + frontend
#   bash scripts/dev-down.sh --all    # também `supabase stop` (stack inteira)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATE_DIR="${ATLAS_DEV_STATE_DIR:-/tmp/atlas-dev}"
FUNCS_PID_FILE="$STATE_DIR/functions.pid"
FRONT_PID_FILE="$STATE_DIR/frontend.pid"

STOP_ALL=0
for arg in "$@"; do
  case "$arg" in
    --all) STOP_ALL=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $arg" >&2
      exit 2
      ;;
  esac
done

info() { printf '  %s\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }
die()  { printf '\n✖ %s\n' "$*" >&2; exit 1; }

pid_cwd() {
  [[ -d "/proc/$1" ]] && readlink -f "/proc/$1/cwd" 2>/dev/null || true
}

pid_cmd() {
  [[ -r "/proc/$1/cmdline" ]] && tr '\0' ' ' < "/proc/$1/cmdline" || true
}

# Encerra o grupo de processos (setsid no dev-up) SOMENTE se o dono confere.
# $1 = pid file, $2.. = padrões aceitos no cmdline.
stop_from_pidfile() {
  local pidfile="$1"; shift
  local patterns=("$@")
  [[ -f "$pidfile" ]] || { info "sem PID file: $pidfile"; return 0; }

  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [[ -z "$pid" || ! -d "/proc/$pid" ]]; then
    warn "PID file obsoleto ($pidfile); removendo."
    rm -f "$pidfile"
    return 0
  fi

  local cwd cmd matched=0
  cwd="$(pid_cwd "$pid")"
  cmd="$(pid_cmd "$pid")"

  if [[ "$cwd" != "$ROOT" ]]; then
    warn "PID $pid não pertence a este repo (cwd=${cwd:-desconhecido}); NÃO vou matar."
    warn "Removendo só o PID file obsoleto: $pidfile"
    rm -f "$pidfile"
    return 0
  fi

  for pattern in "${patterns[@]}"; do
    [[ "$cmd" == *"$pattern"* ]] && { matched=1; break; }
  done
  if (( matched == 0 )); then
    warn "PID $pid em $ROOT não casa o comando esperado; NÃO vou matar."
    warn "cmd: ${cmd:-desconhecido}"
    rm -f "$pidfile"
    return 0
  fi

  info "encerrando PID $pid ($cmd)"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    [[ -d "/proc/$pid" ]] || { rm -f "$pidfile"; ok "encerrado"; return 0; }
    sleep 0.25
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  rm -f "$pidfile"
  ok "encerrado (SIGKILL após timeout)"
}

printf '\n▶ Encerrando ambiente local\n'

# 1) Frontend e functions, por PID file + dono.
stop_from_pidfile "$FRONT_PID_FILE" "vite" "npm run dev"
stop_from_pidfile "$FUNCS_PID_FILE" "functions serve"

# 2) Container do edge runtime DESTE projeto (o CLI pode deixá-lo de pé).
CONTAINER="supabase_edge_runtime_atlas-agenda"
PROJECT_LABEL="$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
if [[ -n "$PROJECT_LABEL" ]]; then
  if [[ "$PROJECT_LABEL" == "atlas-agenda" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 && ok "container $CONTAINER removido"
  else
    warn "container $CONTAINER pertence ao projeto '$PROJECT_LABEL'; NÃO vou remover."
  fi
else
  info "container $CONTAINER já não existe"
fi

# 3) Opcional: stack inteira.
if (( STOP_ALL == 1 )); then
  info "parando a stack Supabase (--all)…"
  if npx supabase stop >/dev/null 2>&1; then
    ok "stack Supabase parada"
  else
    warn "supabase stop retornou erro (já estava parada?)"
  fi
fi

printf '\n✔ dev-down concluído\n\n'
