# PLAN — seed-superadmin-default

## Estratégia
1 arquivo SQL + validação E2E local. Ordem: users → identities → profiles → operators (respeita FKs + freeze). Idempotente via WHERE NOT EXISTS.

## Fases
1. SEED-01 seed.sql: header DEV ONLY + inserts idempotentes + pgcrypto qualificado + instance_id via select + UUID fixo.
2. SEED-02 pgTAP/consulta: operador existe pós-reset; count=1 após 2 seeds; senha trocada preservada.
3. VAL-01 E2E: `db reset` → login 200 aal1 → enroll MFA → aal2 → verify 200 → BOLA negado; 3 resets seguidos.

## Restrições
- Nenhuma migration; nenhuma RLS/hook/Edge/app; sem PII em log; dev-only documentado.
- TDD: teste (consulta E2E) antes de declarar pronto — SQL validado por execução real.

## Fail modes
- Coluna auth divergente (upgrade GoTrue) → pin versão + ADR registra colunas.
- Seed em prod → CI nunca roda seed; só migrations em prod.
