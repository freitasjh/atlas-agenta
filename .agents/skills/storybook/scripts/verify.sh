#!/usr/bin/env bash
# Gate local de UI: silencioso no sucesso, verboso na falha. REDE-ZERO.
# Uso: bash scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
step() {
  local n="$1"; shift
  if ! out=$("$@" 2>&1); then fail=1; echo "=== FAIL: $n ==="; echo "$out" | tail -30; fi
}
step "tokens" node scripts/build-tokens.mjs
step "validate" node scripts/validate.mjs
if [ -f package.json ]; then
  if grep -q '"test:run"' package.json; then step "tests" npm run -s test:run; fi
  if grep -q '"typecheck"' package.json; then step "types" npm run -s typecheck; fi
  if grep -q '"build"' package.json; then step "build" npm run -s build; fi
fi
if [ "$fail" -eq 0 ]; then echo "verify: OK (tokens, validate)"; else echo "verify: FALHOU — ver FAIL acima"; exit 1; fi
