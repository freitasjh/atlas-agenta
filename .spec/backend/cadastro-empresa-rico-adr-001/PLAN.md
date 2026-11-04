# PLAN — ADR-001 Schema tenants endereço (scoped)

## 1. Contexto
- **SPEC:** `.spec/backend/cadastro-empresa-rico-adr-001/SPEC.md`
- **ADR:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-001-schema-tenants-endereco/ADR.md`
- **Goal:** migration aditiva + checks, sem quebrar legado nem RLS.

## 2. Estratégia
Supabase migration versionada (`supabase/migrations/`, regra `db-migration-supabase.md`): aditiva, idempotente, RLS obrigatória (herdada, sem policy nova), validada por `supabase db reset` local + testes de integração (vitest, PostgreSQL real — nunca H2).

## 3. Tarefas
- **[DB-01]** Criar migration `{ts}_tenants_cadastro_rico_endereco.sql` com DDL da SPEC §2.
- **[IT-01]** Teste integração: reset aplica limpo + re-run idempotente + check rejeita mascarado + legado válido.
- **[IT-02]** Teste RLS: admin lê próprio tenant com endereço; outro tenant não vê (herança de policy).

## 4. Riscos
- **LOW:** check com regex POSIX (`~`) — validar sintaxe no reset local.
- **LOW:** `CHAR(8)/CHAR(2)` com blank-padding — app sempre envia exato; teste cobre.
- **MEDIUM:** migration fora de ordem cronológica — gerar timestamp atual.

## 5. Caminho crítico
DB-01 → IT-01 → IT-02 → review → PR.
