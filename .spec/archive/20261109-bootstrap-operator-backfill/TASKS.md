# TASKS — bootstrap-operator-backfill (TDD)

## BE-01 ensureOperator em criado (P0)
- [x] Teste: criado inclui operador (count=1); retry mesmo user_id sem duplicata; 23505 tratado como sucesso; duplo invoke paralelo → count=1 + zero 500 (O1).
- [x] Implementar ensureOperator(userId) + chamada pós-profile em criado.

## BE-02 ja_existe + rollback + erros (P0)
- [x] Teste: ja_existe completa operador faltante; falha operador → delete operador→profile→user nesta ordem + erro explícito; 42501 → bootstrap_bloqueado 403; undefined_table permite legado vs erro real 500; resposta {status,user_id} inalterada; log sem PII/email (O2/O3).
- [x] Implementar ensureOperator em ja_existe + rollback ordenado + mapeamentos.

## BE-03 fake + 5 Deno tests (P0)
- [x] Teste: fake table-aware profiles vs internal_operators + delete tracking; 5 casos (criado-inclui, retry, falha-rollback, bloqueado, ja_existe-completa).
- [x] Implementar fake + suite.

## VAL-01 regressão + E2E (P0)
- [x] Deno bootstrap + verify-operator verdes; typecheck 0; E2E db reset → bootstrap → /internal-admin + enroll MFA sem backfill; BOLA 3 sentidos negado.
