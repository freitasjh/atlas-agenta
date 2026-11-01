#!/usr/bin/env bash
# Teste de concorrência da reserva de troca de senha (ADR-08) contra o banco LOCAL.
#
# Cobre:
#   1. duas reservas simultâneas do mesmo usuário: exatamente uma recebe `claimed`;
#   2. requisição atrasada: a reserva A expira (espera real de 60 s), B toma a reserva, e a
#      liberação e a conclusão tardias de A não mexem na reserva de B (token diferente);
#   3. com a reserva de B ativa, uma terceira reserva recebe `in_progress`;
#   4. a conclusão de B zera o flag e limpa a reserva.
#
# Uso (com `supabase start` ativo e migrations aplicadas):
#   bash supabase/tests/change-password-claim.sh
# Dura cerca de 65 s por causa da expiração real da reserva. Cria e remove um usuário de teste.
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "recusa: DB_URL não aponta para o banco local" >&2; exit 1 ;;
esac

failures=0
tmp_dir="$(mktemp -d)"

q() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -At -c "$1"
}

expect() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then
    echo "ok   $label"
  else
    echo "FAIL $label: obtido='$got' esperado='$want'" >&2
    failures=$((failures + 1))
  fi
}

# Token é a expiração da reserva (timestamptz). Só dígitos, espaço, ':', '.', '+' e '-' são aceitos
# antes de entrar em SQL.
check_token() {
  if [[ ! "$1" =~ ^[0-9:.+\ -]+$ ]]; then
    echo "token inesperado, abortando" >&2
    exit 1
  fi
}

uid="$(q "select gen_random_uuid()")"
email="cp-test-${uid}@example.invalid"

cleanup() {
  # O trigger on_auth_user_created cria um tenant para o usuário; a remoção do tenant apaga o perfil.
  q "delete from public.tenants where id in (select tenant_id from public.profiles where id = '${uid}')" >/dev/null 2>&1 || true
  q "delete from auth.users where id = '${uid}'" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

q "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
   values ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', 'x', now(), '{}', '{}', now(), now())" >/dev/null
# O trigger cria o perfil; aqui só se liga o flag que a troca de senha consome.
q "update public.profiles set must_change_password = true where id = '${uid}'" >/dev/null

claim_sql="select claim_status || '|' || coalesce(claim_token::text, '-') from public.claim_password_change('${uid}')"

# 1. Duas reservas simultâneas.
psql "$DB_URL" -v ON_ERROR_STOP=1 -At -c "$claim_sql" > "$tmp_dir/race1" &
psql "$DB_URL" -v ON_ERROR_STOP=1 -At -c "$claim_sql" > "$tmp_dir/race2" &
wait

race_claimed="$(cat "$tmp_dir/race1" "$tmp_dir/race2" | grep -c '^claimed|' || true)"
race_in_progress="$(cat "$tmp_dir/race1" "$tmp_dir/race2" | grep -c '^in_progress|-$' || true)"
expect "corrida: exatamente uma reserva 'claimed'" "$race_claimed" "1"
expect "corrida: a outra recebe 'in_progress'" "$race_in_progress" "1"

token_a="$(grep '^claimed|' "$tmp_dir/race1" "$tmp_dir/race2" | head -n1 | cut -d'|' -f2)"
check_token "$token_a"

# 2. Requisição A fica lenta: a reserva expira de forma real (60 s).
echo "aguardando a expiração real da reserva A (65 s)..."
sleep 65

b_row="$(q "$claim_sql")"
b_status="${b_row%%|*}"
token_b="${b_row#*|}"
expect "requisição B após expiração recebe 'claimed'" "$b_status" "claimed"
check_token "$token_b"
expect "token de B é diferente do token de A" "$([[ "$token_a" != "$token_b" ]] && echo diferente || echo igual)" "diferente"

# 3. Com a reserva de B ativa, uma terceira troca recebe in_progress.
c_row="$(q "$claim_sql")"
expect "requisição C enquanto B segura a reserva: 'in_progress'" "$c_row" "in_progress|-"

# 4. A chega tarde: libera e conclui com o token antigo. Não pode mexer na reserva de B.
q "select public.release_password_change_claim('${uid}', '${token_a}')" >/dev/null
claim_after_release="$(q "select password_change_claimed_until::text from public.profiles where id = '${uid}'")"
check_token "$claim_after_release"
expect "liberação tardia de A não apaga a reserva de B" \
  "$(q "select password_change_claimed_until = '${token_b}'::timestamptz from public.profiles where id = '${uid}'")" "t"

finish_a="$(q "select public.finish_password_change('${uid}', '${token_a}')")"
expect "conclusão tardia de A retorna false (superada)" "$finish_a" "f"
expect "conclusão tardia de A mantém o flag ligado" \
  "$(q "select must_change_password from public.profiles where id = '${uid}'")" "t"

# 5. B conclui com o próprio token.
finish_b="$(q "select public.finish_password_change('${uid}', '${token_b}')")"
expect "conclusão de B retorna true" "$finish_b" "t"
expect "após B: flag zerado e reserva limpa" \
  "$(q "select must_change_password::text || '|' || coalesce(password_change_claimed_until::text, '-') from public.profiles where id = '${uid}'")" \
  "false|-"

expect "nova reserva após conclusão: 'not_required'" "$(q "$claim_sql" | sed 's/|-$//')" "not_required"

if [[ "$failures" -gt 0 ]]; then
  echo "$failures verificação(ões) falharam" >&2
  exit 1
fi
echo "todas as verificações passaram"
