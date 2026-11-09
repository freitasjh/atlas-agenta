# PROPOSAL — seed-superadmin-default (débito DX, dev-only)

- Tipo: Feature (infra dev)
- Origem: Rota B 6/6 + triagem architect/PM

## Problema
Todo `db reset` apaga o super_admin; bootstrap manual exigido. Retrabalho + tentação de hardcode pior.

## Solução
`supabase/seed.sql` (executa automático no reset local): auth.users (UUID fixo, bcrypt `crypt/gen_salt bf` custo 6, email confirmado, `app_metadata must_change_password=true`) + `auth.identities` (provider email — GoTrue exige) + `profiles(super_admin, tenant NULL)` + `internal_operators`. Tudo `WHERE NOT EXISTS` (re-executável, nunca sobrescreve senha trocada/MFA existente). pgcrypto qualificado (`extensions`), `instance_id` via select. Sem migration (seed não versiona schema), sem RLS/hook/Edge/app.

## Decisão do orquestrador (p/ confirmação no portão)
Mesmo e-mail do bootstrap (`admin@neox.com.br`, `SUPER_ADMIN_EMAIL`) em vez de `.local`: seed e bootstrap viram a MESMA identidade (idempotentes entre si), sem duplicar default. Risco de confusão local-vs-prod mitigado por header `DEV ONLY` + senha provisória distinta + nunca rodar seed em prod.

## Escopo
- Entra: seed.sql + teste E2E `db reset → login + enroll MFA sem bootstrap` + 1 ADR decision-only + doc credencial dev em README local.
- Fora: auto-provision staging/prod, UI gestão, rotação segredos, SSO, mudança RLS/RBAC/tenant, Edge nova.

## Riscos
- Hash provisório versionado → dev-only explícito + troca forçada + MFA forçado.
- Seed em prod por engano → CI nunca roda seed; só `migrations` em prod linkado; header NEVER APPLY PROD.
- Drift schema auth → pin versão local + ADR registra colunas assumidas.

## Delta
- ADDED: supabase/seed.sql + teste reset→login→enroll + ADR decision-only.
- MODIFIED: nenhum (README local se existir seção dev).
- REMOVED: nenhum.
