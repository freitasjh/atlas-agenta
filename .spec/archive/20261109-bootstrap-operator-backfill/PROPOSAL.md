# PROPOSAL — bootstrap-operator-backfill (débito P1)

- Tipo: Feature (melhoria preventiva)
- Origem: débito `.spec/tech-debts/bootstrap-operator-backfill/TASKS.md` + gate Rota B 6/6 + triagem architect/PM

## Problema
`createSuperAdmin` cria auth user + `profiles(super_admin)` sem `internal_operators`. Todo `db reset` repete lockout do backoffice até backfill manual.

## Solução (architect + PM)
Insert operador na mesma operação lógica + `ensureOperator(userId)` em `criado` E `ja_existe` (cura retry pós-crash). Rollback compensatório ordenado (operador+profile antes de `deleteUser`, FK sem cascade). `on conflict do nothing` + `23505` como sucesso. `42501` freeze → `bootstrap_bloqueado` (403). Distinguir `undefined_table` vs erro real. Sem migration; BOLA/hook inalterados.

## Escopo
- Entra: handler `createSuperAdmin` + `ensureOperator` + rollback + fake table-aware + 5 Deno tests + 1 ADR decision-only (amenda ADR-05).
- Fora: UI gestão operadores, backfill órfãos antigos, multi-operador, rate-limit novo, migration/RPC transacional (descartada: exigiria schema change).

## Riscos
- Órfão profile-sem-operador (falha entre passos) → ensureOperator + compensação + log sem PII.
- Órfão operador-sem-user (rollback) → deletar operador+profile antes de deleteUser.
- Regressão bloqueado → teste dedicado + distinguir erro leitura.
- TOCTOU duplo bootstrap → PK + conflict + resolveRace existente.

## Delta
- ADDED: ensureOperator + testes + ADR decision-only.
- MODIFIED: `bootstrap-super-admin/handler.ts` (+ teste).
- REMOVED: nenhum.
