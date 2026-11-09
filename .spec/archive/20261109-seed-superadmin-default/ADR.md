# ADR — seed-superadmin-default (decision-only, amenda ADR-05)

## Decisão
`supabase/seed.sql` dev-only cria o super_admin default em todo `db reset` local: UUID fixo + e-mail pinado `admin@neox.com.br` (mesma identidade do bootstrap) → auth.users (bcrypt bf custo 6, email confirmado, app_metadata must_change_password) → auth.identities (provider email) → profiles(super_admin, tenant NULL) → internal_operators. Tudo `WHERE NOT EXISTS`.

## Alternativas descartadas
- Script pós-reset manual (bootstrap): status quo que gerou o débito; exige humano.
- Migration com seed: versionaria dado, não schema; incorreto.
- RPC transacional de provisionamento: exigiria Edge nova; overkill p/ dev local.
- E-mail `.local` separado: descartado — duplicaria default; seed e bootstrap idempotentes entre si com o mesmo e-mail.

## Interface congelada
Nenhum endpoint/contrato novo. `db reset`/`db seed` passam a incluir 1 super_admin + 1 operador. CI nunca executa seed; prod só recebe migrations.
