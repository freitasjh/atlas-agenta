#!/usr/bin/env bash
#
# deno.sh — resolve o binário do Deno e repassa os argumentos.
#
# Alguns hosts instalam o Deno em ~/.deno/bin sem colocá-lo no PATH. Os scripts
# `check:functions`/`test:functions` apontam para este wrapper para o gate
# funcionar mesmo sem `export PATH="$HOME/.deno/bin:$PATH"` no dotfile.
#
# Ordem de resolução:
#   1) `deno` no PATH (command -v)
#   2) $HOME/.deno/bin/deno
#   3) erro claro com instrução de instalação
#
# Uso:
#   bash scripts/deno.sh check supabase/functions/*/index.ts
#   bash scripts/deno.sh test --allow-env supabase/functions/<funcao>/

set -euo pipefail

if command -v deno >/dev/null 2>&1; then
  DENO_BIN="$(command -v deno)"
elif [[ -x "$HOME/.deno/bin/deno" ]]; then
  DENO_BIN="$HOME/.deno/bin/deno"
else
  echo "Erro: binário 'deno' não encontrado no PATH nem em \$HOME/.deno/bin/deno." >&2
  echo "Instale o Deno antes de rodar o gate das Edge Functions:" >&2
  echo "  curl -fsSL https://deno.land/install.sh | sh" >&2
  echo "  # ou: https://docs.deno.com/runtime/getting_started/installation/" >&2
  exit 127
fi

exec "$DENO_BIN" "$@"
