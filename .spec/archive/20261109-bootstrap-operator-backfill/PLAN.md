# PLAN — bootstrap-operator-backfill

## Estratégia
Mudança cirúrgica em 1 Edge (`bootstrap-super-admin/handler.ts`) + fake table-aware + 5 Deno tests. Sem migration, sem shared, sem hook, sem RLS. TDD: teste antes de cada comportamento.

## Fases
1. BE-01 `ensureOperator` + insert em `criado` (on conflict do nothing; 23505 = sucesso).
2. BE-02 `ensureOperator` em `ja_existe` (cura órfão de crash) + rollback ordenado (operador+profile antes de deleteUser) + 42501→bloqueado + distinguir undefined_table.
3. BE-03 fake table-aware + 5 Deno tests (criado-inclui, retry, falha-rollback, bloqueado, ja_existe-completa).
4. VAL-01 regressão (bootstrap + verify-operator) + typecheck + E2E `db reset → bootstrap → login+enroll`.

## Restrições
- Nenhum endpoint/campo novo; resposta `{status, user_id}` inalterada.
- Log sem PII (só code/status). `mfa_required`/BOLA inalterados.
- Multi-tenancy assert-first: operador 1:1 com super_admin recém-criado.

## Fail modes
- Falha insert operador → compensar 2+1, erro explícito, zero órfão.
- Concorrência → PK + conflict + resolveRace existente.
