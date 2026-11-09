# TASKS — seed-superadmin-default (TDD)

## SEED-01 seed.sql (P0)
- [x] Teste: `db reset` aplica sem erro; re-run idempotente (count=1, sem duplicata).
- [x] Implementar supabase/seed.sql: email pinado `admin@neox.com.br` (interop bootstrap); users(UUID fixo, instance_id via select, aud/role=authenticated, crypt custo 6, email_confirmed_at, raw_app_meta_data must_change) + identities(provider email) + profiles(super_admin, tenant NULL) + operators (tabela vazia libera freeze); header DEV ONLY + README local (senha provisória distinta).

## SEED-02 preservação (P0)
- [x] Teste: senha trocada + MFA enrolado sobrevivem ao re-seed (sem overwrite).
- [x] Ajustar WHERE NOT EXISTS se vazar overwrite; BOLA 3 sentidos explicitados.

## VAL-01 E2E + ADR (P0)
- [x] E2E: reset → login 200 aal1 → enroll → aal2 → verify 200; BOLA 3/3 negado; 3 resets seguidos; `db seed` isolado idempotente + zero tabela tenant tocada; vitest/typecheck regressão 0.
- [x] Escrever ADR decision-only (UUID fixo, email único, ordem, pgcrypto, identities, prod-nunca).
