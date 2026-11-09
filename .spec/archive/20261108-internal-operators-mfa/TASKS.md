# TASKS — internal-operators-mfa (TDD) — revisado PM

## BE-01 Tabela + RLS + backfill (P0)
- [x] Teste pgTAP: deny-all (anon/auth 0 linhas), helper definer só service_role, backfill contagem, freeze trigger 42501 barra super_admin, audit append-only sem update/delete, `disabled_at/created_by` presentes.
- [x] Teste NEW: `count(internal_operators)>=2` pós-backfill (Aceite 7); órfão sem auth.users = report manual, proíbe auto-criar; seed via migration auditada (não código).
- [x] Implementar migration internal_operators + is_internal_operator() + audit + backfill + freeze.

## BE-02 verify-operator (P0)
- [x] Teste Deno: JWT inválido 401; sem operador 403; sem AAL2 MFA_REQUIRED 403; operador+AAL2 200 `{is_operator,aal,user_id}`; timeout fail-closed; `verify_jwt=true`; sem cache client como prova; sem PII log.
- [x] Implementar Edge verify-operator + internal-operator.ts (molde admin-plan).

## BE-03 Gates/hook (P0)
- [x] Teste: super_admin sem operador+AAL2 negado em custom-access-token (lê Auth API, não claim)/identity/admin gates; `bootstrap_super_admin` recusa novos; lista policies `*_super_admin` em anexo F1-drop + risco aceito datado.
- [x] Implementar negação + bootstrap freeze.

## FE-01 Rota + guard (P0)
- [x] Teste: sem MFA → redirect mfa/enroll sem dado (mfa_pending ≤10min); operador ok entra; tenant → /internal-admin 403 + hide nav.
- [x] Implementar /internal-admin + RequireInternalOperator (sem RequireRole/tenant; nunca PostgREST tenant direto).

## FE-02 Telas login/MFA/enroll (P0)
- [x] Teste: enroll exige 1 TOTP antes de active + checkbox backup 1x; OTP colar ≤2s, inválido restantes+foco, 5x lockout timer; login genérico anti-enumeração texto+tempo idênticos; paths exatos /login|/mfa|/enroll; 1 primário/tela; role=alert/aria-live/tabular-nums; shell mfa_pending bloqueado; 375px sem scroll-x, CTA ≥44pt; teclado+leitor total.
- [x] Implementar 3 telas (Auth Card max-w-md, OTP numeric+one-time-code, QR + chave copiável).

## VAL-01 Harness (P0)
- [x] pgTAP BOLA 3 sentidos (matriz IT) + E2E enroll→login→verify + Deno + vitest + typecheck/build 0 + Chrome 0 erro/rede 0 4xx + grep sem .from tenant + i18n pt-BR.
