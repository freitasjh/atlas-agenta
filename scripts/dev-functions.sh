#!/usr/bin/env bash
#
# dev-functions.sh — sobe as Edge Functions do Atlas Agenda localmente.
#
# Conveniência de dev: encapsula `supabase functions serve` lendo os segredos
# via --env-file (nunca embutidos neste script). Alvo padrao: a função `whatsapp`.
#
# Fluxo completo de desenvolvimento local (execute em terminais separados):
#   1) supabase start                 # sobe o banco/Postgres + stack local
#   2) bash scripts/dev-functions.sh  # sobe as Edge Functions (este script)
#   3) npm run dev                    # sobe o frontend (Vite)
#
# Uso:
#   bash scripts/dev-functions.sh            # serve a função `whatsapp`
#   bash scripts/dev-functions.sh <funcao>   # serve outra função pelo nome
#
# Observacao: o dev server do Vite pode subir em porta alternativa
# (5173 -> 5174 -> 5175) quando ha processos antigos ocupando a porta.

set -euo pipefail

FUNCTION_NAME="${1:-whatsapp}"
ENV_FILE="supabase/functions/.env"

# Checa que o CLI do Supabase esta disponivel.
if ! command -v supabase >/dev/null 2>&1; then
  echo "Erro: o CLI 'supabase' nao foi encontrado no PATH." >&2
  echo "Instale o Supabase CLI antes de rodar as functions localmente:" >&2
  echo "  https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

# Checa que o arquivo de segredos existe (sem nunca ecoar seu conteudo).
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Erro: arquivo de variaveis de ambiente nao encontrado: $ENV_FILE" >&2
  echo "Copie o modelo e preencha os valores antes de subir as functions:" >&2
  echo "  cp supabase/functions/.env.example supabase/functions/.env" >&2
  exit 1
fi

echo "Subindo Edge Function '$FUNCTION_NAME' com --env-file $ENV_FILE ..."
exec supabase functions serve "$FUNCTION_NAME" --env-file "$ENV_FILE"
