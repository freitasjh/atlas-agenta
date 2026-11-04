#!/usr/bin/env bash
# Um cenário completo do QA da ADR-14: reset → bootstrap → cadastro pela UI (D1)
# → roteiro dos 12 itens. Encerramento sempre por PID (nunca `pkill -f`).
set -uo pipefail

LABEL="${1:?label}"; W="${2:?width}"; H="${3:?height}"; THEME="${4:?theme}"
EMAIL="${5:-qa-ui-${LABEL}@teste.local}"
PASSWORD="${6:-TenantQa@2026}"
COMPANY="${7:-QA UI ${LABEL}}"
SEGMENT="${8:-clinica}"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT" || exit 1
STATE=/tmp/opencode/atlas-qa
mkdir -p "$STATE"
chmod 700 "$STATE"

echo "[$LABEL] db reset"
supabase db reset > "$STATE/reset-$LABEL.log" 2>&1 || { echo "[$LABEL] reset FALHOU"; tail -20 "$STATE/reset-$LABEL.log"; exit 1; }

echo "[$LABEL] bootstrap"
SECRET=$(grep '^BOOTSTRAP_SECRET=' "$STATE/functions.env" | cut -d= -f2-)
CODE=$(curl -s -o "$STATE/bootstrap-$LABEL.json" -w '%{http_code}' -X POST \
  http://127.0.0.1:54321/functions/v1/bootstrap-super-admin \
  -H 'content-type: application/json' -H "x-bootstrap-secret: $SECRET" -d '{}')
echo "[$LABEL] bootstrap status=$CODE"
[ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { cat "$STATE/bootstrap-$LABEL.json"; exit 1; }

echo "[$LABEL] cadastro pela UI (D1)"
node harness/qa/tools/check-signup.mjs --label "$LABEL" --width "$W" --height "$H" \
  --theme "$THEME" --email "$EMAIL" --password "$PASSWORD" --company "$COMPANY" \
  --segment "$SEGMENT" > "$STATE/signup-$LABEL.out" 2>&1
SU=$?
echo "[$LABEL] signup exit=$SU"

echo "[$LABEL] banco (D1)"
docker exec supabase_db_atlas-agenda psql -U postgres -d postgres -A -F'|' -c "
select u.email, p.role, t.trade_name, t.segment, t.subscription_status,
       (select count(*) from message_templates m where m.tenant_id = t.id) as templates,
       (select string_agg(m.template_key, ',' order by m.template_key) from message_templates m where m.tenant_id = t.id) as keys,
       (select count(*) from tenants) as tenant_count
from tenants t join profiles p on p.tenant_id = t.id join auth.users u on u.id = p.id;" \
  > "$STATE/d1-db-$LABEL.txt" 2>&1
cat "$STATE/d1-db-$LABEL.txt"

echo "[$LABEL] roteiro 12 itens"
QA_OUT="$ROOT/harness/qa" QA_BASE_URL="${QA_BASE_URL:-http://127.0.0.1:5174}" \
QA_TENANT_EMAIL="$EMAIL" QA_TENANT_PASSWORD="$PASSWORD" \
node harness/qa/tools/run-combo.mjs --label "$LABEL" --width "$W" --height "$H" --theme "$THEME" \
  > "$STATE/combo-$LABEL.out" 2>&1
CR=$?
echo "[$LABEL] combo exit=$CR"
tail -60 "$STATE/combo-$LABEL.out"
exit "$CR"
