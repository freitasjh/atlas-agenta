#!/usr/bin/env bash
#
# dev-up.sh — sobe o ambiente local COMPLETO do Atlas Agenda e prova o fluxo
# cadastro -> agenda -> PIX.
#
# O que faz, em ordem:
#   1. preflight (docker, node, deno, portas, .env de segredos, Evolution, Asaas)
#   2. sobe a stack Supabase (`supabase start`) e espera REST/Auth saudáveis
#   3. aplica migrations pendentes (nunca `db reset` por padrão)
#   4. sobe as Edge Functions com --env-file e prova que o runtime responde
#   5. sobe o frontend (Vite) em background
#   6. roda o seed determinístico (scripts/dev-seed.mjs)
#   7. roda o smoke test ponta a ponta (scripts/dev-smoke.mjs)
#
# É idempotente: o que já está de pé e saudável é reaproveitado. Nunca usa
# `pkill -f`; portas/processos são checados pelo dono antes de qualquer ação.
#
# Uso:
#   bash scripts/dev-up.sh            # fluxo completo
#   bash scripts/dev-up.sh --no-smoke # sobe sem rodar o smoke
#   bash scripts/dev-up.sh --reset    # APAGA o banco local e reaplica migrations
#
# Encerrar:
#   bash scripts/dev-down.sh          # só o que este script subiu
#   bash scripts/dev-down.sh --all    # também `supabase stop`

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STATE_DIR="${ATLAS_DEV_STATE_DIR:-/tmp/atlas-dev}"
FUNCS_PID_FILE="$STATE_DIR/functions.pid"
FUNCS_LOG="$STATE_DIR/functions.log"
FRONT_PID_FILE="$STATE_DIR/frontend.pid"
FRONT_LOG="$STATE_DIR/frontend.log"
SUPABASE_LOG="$STATE_DIR/supabase-start.log"
ENV_FILE="supabase/functions/.env"

RUN_SMOKE=1
RESET_DB=0
for arg in "$@"; do
  case "$arg" in
    --no-smoke) RUN_SMOKE=0 ;;
    --reset) RESET_DB=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $arg" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$STATE_DIR"

info()  { printf '  %s\n' "$*"; }
ok()    { printf '  ✔ %s\n' "$*"; }
warn()  { printf '  ⚠ %s\n' "$*"; }
step()  { printf '\n▶ %s\n' "$*"; }
hint()  { printf '    → %s\n' "$*" >&2; }
die() {
  printf '\n✖ %s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Utilitários
# ---------------------------------------------------------------------------

# Lê uma chave de um arquivo dotenv SEM avaliar o valor (evita expansão de `$`).
env_get() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -v k="$key" '
    /^[[:space:]]*#/ { next }
    index($0, k "=") == 1 {
      v = substr($0, length(k) + 2)
      gsub(/^"/, "", v); gsub(/"$/, "", v)
      print v
      exit
    }
  ' "$file"
}

mask_url() {
  local url="$1"
  printf '%s' "$url" | sed -E 's#^(https?://[^/]+).*#\1#'
}

http_code() {
  local timeout="$1"; shift
  local out
  out="$(curl -sS -o "$STATE_DIR/.http-body" -w '%{http_code}' --max-time "$timeout" "$@" 2>/dev/null || true)"
  printf '%s' "${out:-000}"
}

port_pids() {
  lsof -ti ":$1" 2>/dev/null || true
}

# `lsof` pode não enxergar sockets de processos de outro usuário (ex.:
# docker-proxy). Para decidir "porta ocupada" usamos `ss`; para achar o dono,
# `lsof`/`docker ps` continuam valendo.
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    port_pids "$port" | grep -q .
  fi
}

pid_cwd() {
  [[ -d "/proc/$1" ]] && readlink -f "/proc/$1/cwd" 2>/dev/null || true
}

pid_cmd() {
  [[ -r "/proc/$1/cmdline" ]] && tr '\0' ' ' < "/proc/$1/cmdline" || true
}

pid_matches() {
  local pid="$1" pattern="$2"
  [[ -d "/proc/$pid" ]] || return 1
  [[ "$(pid_cwd "$pid")" == "$ROOT" ]] || return 1
  [[ "$(pid_cmd "$pid")" == *"$pattern"* ]] || return 1
  return 0
}

status_env() {
  npx supabase status -o env 2>/dev/null || true
}

status_key() {
  local key="$1"
  status_env | awk -v k="$key" -F= '$1 == k { gsub(/^"|"$/, "", $2); print $2; exit }'
}

stack_healthy() {
  local anon="${ANON_KEY:-}"
  [[ -n "$anon" ]] || return 1
  local rest auth
  rest="$(http_code 5 -H "apikey: $anon" "$API_URL/rest/v1/")"
  auth="$(http_code 5 "$API_URL/auth/v1/health")"
  [[ "$rest" == 2* && "$auth" == "200" ]]
}

functions_probe() {
  local code
  code="$(http_code 10 -X POST "$API_URL/functions/v1/signup-tenant" \
    -H 'Content-Type: application/json' -d '{}')"
  [[ "$code" == "400" ]]
}

frontend_probe() {
  local code
  code="$(http_code 5 "http://localhost:5173/")"
  [[ "$code" == "200" ]]
}

functions_diagnosis() {
  local container="supabase_edge_runtime_atlas-agenda"
  if docker inspect "$container" >/dev/null 2>&1; then
    printf '    container: %s\n' \
      "$(docker inspect "$container" --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' 2>/dev/null)"
  fi
  if grep -qE 'exit 137|Killed|out of memory|OOM' "$FUNCS_LOG" 2>/dev/null; then
    printf '    log: %s\n' "$(grep -E 'exit 137|Killed|out of memory|OOM' "$FUNCS_LOG" | tail -1)"
    hint "exit 137 = runtime morto por falta de memória. Libere RAM ou aumente o limite do Docker Desktop/daemon."
  fi
  printf '    últimas linhas de %s:\n' "$FUNCS_LOG"
  if [[ -s "$FUNCS_LOG" ]]; then
    tail -8 "$FUNCS_LOG" 2>/dev/null | sed 's/^/      /' || true
  else
    printf '      (log vazio — runtime pode ter sido iniciado pelo `supabase start`)\n'
    docker logs --tail 8 "$container" 2>&1 | sed 's/^/      /' || true
  fi
}

stop_pid_group() {
  local pid="$1"
  [[ -d "/proc/$pid" ]] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    [[ -d "/proc/$pid" ]] || return 0
    sleep 0.25
  done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
step "1/7 Preflight"

command -v docker >/dev/null 2>&1 || die "docker não encontrado no PATH. Instale o Docker Engine/Desktop e tente de novo."
docker info >/dev/null 2>&1 || die "daemon do Docker não está respondendo. Inicie o Docker e tente de novo."
ok "docker ativo"

command -v node >/dev/null 2>&1 || die "node não encontrado no PATH. Instale Node >= 22."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
REQUIRED_MAJOR="$(node -p 'const e=require("./package.json").engines?.node||">=22"; (e.match(/\d+/)||["22"])[0]')"
[[ "$NODE_MAJOR" -ge "$REQUIRED_MAJOR" ]] \
  || die "Node $(node -v) abaixo do exigido (engines: >=$REQUIRED_MAJOR). Atualize o Node."
ok "node $(node -v)"

command -v npx >/dev/null 2>&1 || die "npx não encontrado no PATH (vem com o Node)."
npx supabase --version >/dev/null 2>&1 \
  || die "Supabase CLI indisponível via 'npx supabase'. Rode 'npm install' na raiz do repo."
ok "supabase CLI $(npx supabase --version 2>/dev/null | tail -1)"

if ! command -v deno >/dev/null 2>&1; then
  if [[ -x "$HOME/.deno/bin/deno" ]]; then
    export PATH="$HOME/.deno/bin:$PATH"
    ok "deno adicionado ao PATH ($HOME/.deno/bin)"
  else
    die "deno não encontrado no PATH nem em \$HOME/.deno/bin.
    Instale com: curl -fsSL https://deno.land/install.sh | sh
    Depois reabra o terminal (ou export PATH=\"\$HOME/.deno/bin:\$PATH\")."
  fi
fi
ok "deno $(deno --version 2>/dev/null | head -1)"

[[ -f "$ENV_FILE" ]] || die "arquivo de segredos ausente: $ENV_FILE
    Copie o modelo e preencha: cp supabase/functions/.env.example $ENV_FILE"

if ! git check-ignore -q "$ENV_FILE"; then
  die "$ENV_FILE NÃO está ignorado pelo git — risco de commitar segredo.
    Verifique a regra '.env*' no .gitignore antes de continuar."
fi
ok "$ENV_FILE presente e ignorado pelo git"

REQUIRED_KEYS=(
  ASAAS_MASTER_KEY
  ASAAS_SUPER_ADMIN_API_KEY
  ASAAS_SUPER_ADMIN_ENVIRONMENT
  EVOLUTION_MODE
  EVOLUTION_API_URL
  EVOLUTION_API_KEY
)
MISSING_KEYS=()
for key in "${REQUIRED_KEYS[@]}"; do
  [[ -n "$(env_get "$ENV_FILE" "$key")" ]] || MISSING_KEYS+=("$key")
done
if (( ${#MISSING_KEYS[@]} > 0 )); then
  printf '    chaves ausentes/vazias em %s (valores não são impressos):\n' "$ENV_FILE" >&2
  for key in "${MISSING_KEYS[@]}"; do printf '      - %s\n' "$key" >&2; done
  die "preencha as chaves acima em $ENV_FILE e rode de novo."
fi
ok "segredos obrigatórios presentes em $ENV_FILE"

EVOLUTION_MODE_VALUE="$(env_get "$ENV_FILE" EVOLUTION_MODE | tr '[:upper:]' '[:lower:]')"
case "$EVOLUTION_MODE_VALUE" in
  mock|real) ;;
  *) die "EVOLUTION_MODE inválido ('$EVOLUTION_MODE_VALUE'). Use 'mock' ou 'real'." ;;
esac

if [[ "$EVOLUTION_MODE_VALUE" == "real" ]]; then
  EVOLUTION_URL="$(env_get "$ENV_FILE" EVOLUTION_API_URL)"
  EVOLUTION_KEY="$(env_get "$ENV_FILE" EVOLUTION_API_KEY)"
  EVOLUTION_URL="${EVOLUTION_URL%/}"
  EVO_CODE="$(http_code 10 -H "apikey: $EVOLUTION_KEY" "$EVOLUTION_URL/instance/fetchInstances")"
  if [[ "$EVO_CODE" != "200" ]]; then
    printf '' >&2
    die "Evolution não respondeu 200 em %s/instance/fetchInstances (status %s).
    Causa provável: túnel ngrok caiu ou EVOLUTION_API_URL/EVOLUTION_API_KEY mudou.
    Confira o ngrok e atualize %s; depois rode de novo." \
      "$(mask_url "$EVOLUTION_URL")" "$EVO_CODE" "$ENV_FILE"
  fi
  ok "Evolution acessível (modo real) em $(mask_url "$EVOLUTION_URL")"
else
  warn "EVOLUTION_MODE=mock (lembrete: instâncias do WhatsApp não conectam de verdade)"
fi

ASAAS_KEY="$(env_get "$ENV_FILE" ASAAS_SUPER_ADMIN_API_KEY)"
ASAAS_ENV="$(env_get "$ENV_FILE" ASAAS_SUPER_ADMIN_ENVIRONMENT)"
case "$ASAAS_ENV" in
  sandbox)   ASAAS_BASE="https://sandbox.asaas.com/api/v3" ;;
  production) ASAAS_BASE="https://api.asaas.com/v3" ;;
  *) die "ASAAS_SUPER_ADMIN_ENVIRONMENT inválido. Use 'sandbox' ou 'production'." ;;
esac

ASAAS_CODE="$(http_code 20 -H "access_token: $ASAAS_KEY" "$ASAAS_BASE/myAccount")"
if [[ "$ASAAS_CODE" != "200" ]]; then
  die "Asaas recusou a credencial (status $ASAAS_CODE) em $ASAAS_ENV.
    Confira ASAAS_SUPER_ADMIN_API_KEY em $ENV_FILE.
    Chaves do Asaas começam com \$aact_ e são específicas por ambiente (sandbox != produção).
    Nenhum valor de chave foi impresso."
fi
ok "credencial Asaas válida ($ASAAS_ENV)"

PIX_CODE="$(http_code 15 -H "access_token: $ASAAS_KEY" "$ASAAS_BASE/pix/addressKeys")"
if [[ "$PIX_CODE" == "200" ]]; then
  if grep -q '"status"[[:space:]]*:[[:space:]]*"ACTIVE"' "$STATE_DIR/.http-body" 2>/dev/null; then
    ok "conta Asaas tem chave Pix ativa"
  else
    warn "nenhuma chave Pix ATIVA na conta Asaas — o smoke (PIX) vai falhar.
    Cadastre uma chave em https://sandbox.asaas.com (Pix > Chaves)."
  fi
elif [[ "$PIX_CODE" == "401" || "$PIX_CODE" == "403" ]]; then
  warn "não foi possível listar chaves Pix (status $PIX_CODE); seguindo."
else
  warn "consulta de chaves Pix retornou $PIX_CODE; seguindo."
fi

# Portas: 54321/54322 são da stack; 5173 é do Vite.
ANON_KEY="$(status_key ANON_KEY)"
API_URL="$(status_key API_URL)"
API_URL="${API_URL:-http://127.0.0.1:54321}"

for port in 54321 54322; do
  if ! port_in_use "$port"; then
    ok "porta $port livre"
    continue
  fi
  if stack_healthy; then
    ok "porta $port já é a stack deste projeto (reaproveitando)"
  else
    OWNER="$(docker ps --filter "publish=$port" --format '{{.Names}} ({{.Label "com.docker.compose.project"}})' 2>/dev/null | head -3 | paste -sd ', ' -)"
    die "porta $port ocupada por outro processo/stack.
    Dono: ${OWNER:-desconhecido}
    Encerre o processo dono ou rode este projeto em outra porta (supabase/config.toml). Nunca matamos processo alheio."
  fi
done

if [[ -f "$FRONT_PID_FILE" ]] && { pid_matches "$(cat "$FRONT_PID_FILE")" "vite" || pid_matches "$(cat "$FRONT_PID_FILE")" "npm run dev"; }; then
  ok "frontend já está rodando (PID $(cat "$FRONT_PID_FILE"))"
elif port_in_use 5173; then
  OWNER_PID="$(port_pids 5173 | head -1)"
  OWNER_CMD="$(pid_cmd "$OWNER_PID")"
  OWNER_CWD="$(pid_cwd "$OWNER_PID")"
  if [[ "$OWNER_CWD" == "$ROOT" && "$OWNER_CMD" == *"vite"* ]]; then
    ok "porta 5173 já servida pelo Vite deste projeto (PID $OWNER_PID)"
  else
    die "porta 5173 ocupada por outro processo.
    PID: $OWNER_PID
    cwd: ${OWNER_CWD:-desconhecido}
    cmd: ${OWNER_CMD:-desconhecido}
    Encerre esse processo ou use outra porta. Nunca matamos processo alheio."
  fi
else
  ok "porta 5173 livre"
fi

export CUSTOM_ACCESS_TOKEN_HOOK_SECRET="$(env_get "$ENV_FILE" CUSTOM_ACCESS_TOKEN_HOOK_SECRET)"
if [[ -n "${CUSTOM_ACCESS_TOKEN_HOOK_SECRET:-}" ]]; then
  ok "CUSTOM_ACCESS_TOKEN_HOOK_SECRET carregado do .env de functions"
else
  warn "CUSTOM_ACCESS_TOKEN_HOOK_SECRET ausente — logins podem falhar (hook custom_access_token)."
fi

# ---------------------------------------------------------------------------
# 2. Stack Supabase
# ---------------------------------------------------------------------------
step "2/7 Stack Supabase"

ANON_KEY="$(status_key ANON_KEY)"
API_URL="$(status_key API_URL)"
API_URL="${API_URL:-http://127.0.0.1:54321}"

if stack_healthy; then
  ok "stack já saudável em $API_URL"
else
  info "subindo stack (docker + Postgres + Auth + REST)…"
  if ! npx supabase start >"$SUPABASE_LOG" 2>&1; then
    tail -20 "$SUPABASE_LOG" | sed 's/^/      /' >&2 || true
    die "falha ao subir a stack Supabase. Veja o log completo em $SUPABASE_LOG."
  fi
  ANON_KEY="$(status_key ANON_KEY)"
  API_URL="$(status_key API_URL)"
  API_URL="${API_URL:-http://127.0.0.1:54321}"

  READY=0
  for _ in $(seq 1 90); do
    if stack_healthy; then READY=1; break; fi
    sleep 1
  done
  (( READY == 1 )) || die "stack subiu mas REST/Auth não responderam saudáveis em 90s.
    REST: $(http_code 5 -H "apikey: ${ANON_KEY:-}" "$API_URL/rest/v1/")
    Auth: $(http_code 5 "$API_URL/auth/v1/health")
    Log: $SUPABASE_LOG"
  ok "stack saudável em $API_URL"
fi

# ---------------------------------------------------------------------------
# 3. Migrations
# ---------------------------------------------------------------------------
step "3/7 Migrations"

MIGRATION_LOG="$STATE_DIR/migrations.log"
if (( RESET_DB == 1 )); then
  warn "--reset solicitado: apagando o banco local e reaplicando todas as migrations"
  if ! npx supabase db reset --local --yes >"$MIGRATION_LOG" 2>&1; then
    tail -20 "$MIGRATION_LOG" | sed 's/^/      /' >&2 || true
    die "db reset falhou. Log: $MIGRATION_LOG"
  fi
  ok "banco local recriado pelas migrations"
elif npx supabase migration up --local >"$MIGRATION_LOG" 2>&1; then
  PENDING="$(grep -cE 'Applying migration|Applying' "$MIGRATION_LOG" 2>/dev/null || true)"
  if [[ "${PENDING:-0}" -gt 0 ]]; then
    ok "migrations aplicadas ($PENDING)"
  else
    ok "migrations em dia"
  fi
else
  tail -20 "$MIGRATION_LOG" | sed 's/^/      /' >&2 || true
  die "falha ao aplicar migrations. Log: $MIGRATION_LOG
    Se o banco local estiver corrompido, use conscientemente: npx supabase db reset"
fi

# ---------------------------------------------------------------------------
# 4. Edge Functions
# ---------------------------------------------------------------------------
step "4/7 Edge Functions"

export PATH="$HOME/.deno/bin:$PATH"

start_functions() {
  : >"$FUNCS_LOG"
  setsid npx supabase functions serve --env-file "$ENV_FILE" >>"$FUNCS_LOG" 2>&1 &
  echo $! >"$FUNCS_PID_FILE"
}

wait_functions() {
  local attempts="$1"
  for _ in $(seq 1 "$attempts"); do
    if functions_probe; then return 0; fi
    sleep 1
  done
  return 1
}

if functions_probe; then
  if [[ -f "$FUNCS_PID_FILE" && "$ENV_FILE" -nt "$FUNCS_LOG" ]]; then
    info "segredos de functions mudaram; reiniciando o runtime para recarregar o .env"
    stop_pid_group "$(cat "$FUNCS_PID_FILE")"
    rm -f "$FUNCS_PID_FILE"
    if docker inspect supabase_edge_runtime_atlas-agenda >/dev/null 2>&1; then
      docker rm -f supabase_edge_runtime_atlas-agenda >/dev/null 2>&1 || true
    fi
    start_functions
    if ! wait_functions 120; then
      functions_diagnosis
      die "runtime não voltou após recarregar o .env. Log: $FUNCS_LOG"
    fi
    ok "runtime das Edge Functions recarregado"
  else
    ok "runtime das Edge Functions já está saudável"
  fi
else
  if [[ -f "$FUNCS_PID_FILE" ]] && pid_matches "$(cat "$FUNCS_PID_FILE")" "functions serve"; then
    info "processo de functions existe (PID $(cat "$FUNCS_PID_FILE")) mas não responde; reiniciando."
    stop_pid_group "$(cat "$FUNCS_PID_FILE")"
    rm -f "$FUNCS_PID_FILE"
  fi

  info "subindo Edge Functions (primeira execução baixa/bundle pode demorar)…"
  start_functions
  if ! wait_functions 120; then
    warn "runtime não respondeu 400 no signup-tenant. Diagnóstico:"
    functions_diagnosis

    warn "tentando reiniciar o runtime 1 vez…"
    stop_pid_group "$(cat "$FUNCS_PID_FILE" 2>/dev/null || echo 0)"
    rm -f "$FUNCS_PID_FILE"
    if docker inspect supabase_edge_runtime_atlas-agenda >/dev/null 2>&1; then
      docker rm -f supabase_edge_runtime_atlas-agenda >/dev/null 2>&1 || true
    fi
    start_functions
    if ! wait_functions 120; then
      functions_diagnosis
      die "runtime das Edge Functions continua morto (provável exit 137/OOM).
    Libere memória do host e rode de novo. Log: $FUNCS_LOG"
    fi
  fi
  ok "runtime das Edge Functions saudável (POST signup-tenant {} → 400)"
fi

# ---------------------------------------------------------------------------
# 5. Frontend
# ---------------------------------------------------------------------------
step "5/7 Frontend (Vite)"

start_frontend() {
  : >"$FRONT_LOG"
  setsid npm run dev -- --host 127.0.0.1 --port 5173 --strictPort >>"$FRONT_LOG" 2>&1 &
  echo $! >"$FRONT_PID_FILE"
}

wait_frontend() {
  for _ in $(seq 1 60); do
    if frontend_probe; then return 0; fi
    sleep 1
  done
  return 1
}

if frontend_probe; then
  ok "frontend já responde em http://localhost:5173"
else
  if [[ -f "$FRONT_PID_FILE" ]] && { pid_matches "$(cat "$FRONT_PID_FILE")" "vite" || pid_matches "$(cat "$FRONT_PID_FILE")" "npm run dev"; }; then
    stop_pid_group "$(cat "$FRONT_PID_FILE")"
    rm -f "$FRONT_PID_FILE"
  fi
  info "subindo o Vite…"
  start_frontend
  if ! wait_frontend; then
    tail -20 "$FRONT_LOG" | sed 's/^/      /' >&2 || true
    die "frontend não respondeu 200 em http://localhost:5173. Log: $FRONT_LOG"
  fi
  ok "frontend em http://localhost:5173"
fi

# ---------------------------------------------------------------------------
# 6. Seed
# ---------------------------------------------------------------------------
step "6/7 Seed determinístico"

if node scripts/dev-seed.mjs; then
  ok "seed concluído (idempotente)"
else
  die "seed falhou. Corrija o erro acima e rode de novo (nada foi duplicado)."
fi

# ---------------------------------------------------------------------------
# 7. Smoke
# ---------------------------------------------------------------------------
if (( RUN_SMOKE == 1 )); then
  step "7/7 Smoke test (cadastro → agenda → PIX)"
  if ! node scripts/dev-smoke.mjs; then
    die "smoke test falhou. O ambiente continua de pé para diagnóstico.
    Logs: $FUNCS_LOG · $FRONT_LOG
    Encerre com: bash scripts/dev-down.sh"
  fi
else
  step "7/7 Smoke test (pulado por --no-smoke)"
fi

# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------
LEGACY_URL="$(status_key STUDIO_URL)"
printf '\n✔ Ambiente pronto\n\n'
printf '  Frontend:        http://localhost:5173\n'
printf '  Supabase API:    %s\n' "$API_URL"
printf '  Studio:          %s\n' "${LEGACY_URL:-http://127.0.0.1:54323}"
printf '  Functions log:   %s\n' "$FUNCS_LOG"
printf '  Frontend log:    %s\n' "$FRONT_LOG"
printf '  PIDs:            %s · %s\n' \
  "$([[ -f "$FUNCS_PID_FILE" ]] && cat "$FUNCS_PID_FILE" || echo '-')" \
  "$([[ -f "$FRONT_PID_FILE" ]] && cat "$FRONT_PID_FILE" || echo '-')"
printf '\n  Parar:           bash scripts/dev-down.sh\n'
printf '  Parar + stack:   bash scripts/dev-down.sh --all\n\n'
