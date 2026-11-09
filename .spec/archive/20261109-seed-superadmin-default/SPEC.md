# SPEC — seed-superadmin-default (dev-only)

## 1 Visão
`supabase/seed.sql` cria o super_admin default em todo `db reset` local: auth.users + auth.identities + profiles(super_admin) + internal_operators. Idempotente, sem bootstrap manual. Sem migration (seed não versiona schema), sem RLS/hook/Edge/app.

## 2 Semântica congelada
- Identidade única = e-mail do bootstrap (`admin@neox.com.br`): seed e bootstrap idempotentes entre si, sem duplicar default.
- Ordem: `auth.users` (UUID fixo, `instance_id` via select, `aud/role=authenticated`, bcrypt `extensions.crypt/gen_salt bf` custo 6, `email_confirmed_at=now()`, `raw_app_meta_data={must_change_password:true}`) → `auth.identities` (provider email, `where not exists`) → `profiles(super_admin, tenant NULL)` → `internal_operators` (respeita freeze: tabela vazia libera).
- Tudo `WHERE NOT EXISTS`: re-executável, nunca sobrescreve senha trocada/MFA existente/operador existente.
- Header `DEV ONLY - NEVER APPLY PROD`; senha provisória distinta, documentada em README local.

## 3 Aceite
1. `db reset` limpo → login 200 aal1 com provisória, sem bootstrap.
2. 3 resets seguidos → 1 operador, 0 erro, 0 duplicata.
3. Re-run com senha trocada/MFA enrolado → preservados (sem overwrite).
4. Enroll MFA → aal2 → verify-operator 200; BOLA inalterado.
5. `db seed` isolado idempotente; nenhuma tabela tenant tocada.

## 4 Testes
- E2E: reset → login → enroll → aal2 + BOLA 3 sentidos (harness qa-engineer).
- pgTAP: operador existe pós-reset; count=1 após 2 seeds.
- Vitest/typecheck regressão (sem código app tocado).

## 5 Segurança Fase 1: pass
STRIDE: Spoofing (seed cria 1 identidade fixa dev) → troca+MFA forçados 1º login; Tampering → WHERE NOT EXISTS, sem overwrite; Repudiation → reset local sem auditoria (dev); Info → senha provisória dev-only + header; Elevation → profile super_admin + operador juntos, RLS/hook inalterados; DoS → n/a. Veredito: pass (0 🔴; risco residual = seed em prod por engano, mitigado por CI-nunca-roda-seed + header).

## 6 Delta
- ADDED: supabase/seed.sql + teste E2E reset→login→enroll + ADR decision-only.
- MODIFIED: nenhum (README local se houver seção dev).
- REMOVED: nenhum.
