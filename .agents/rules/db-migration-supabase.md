# Migração de Banco — Supabase (PostgreSQL)

Fonte de verdade para mudanças de schema no Atlas Agenda. Usar quando a stack é Supabase (este projeto).

## Regras obrigatórias

1. Toda mudança de schema é migration versionada em supabase/migrations/. Nunca alterar schema só pela UI do Supabase sem gerar migration.
2. Naming: {YYYYMMDDHHMMSS}_{descricao_snake_case}.sql (timestamp-based, ordenação cronológica).
3. Aditiva por padrão: preferir add column if not exists, create index if not exists. Nunca drop de coluna/tabela em produção sem migration dedicada e gate humano.
4. Idempotência: migration re-executável (if not exists, drop ... if exists antes de create, backfill com where ... is null).
5. RLS obrigatório: toda tabela de domínio tem tenant_id + índice + policy. Sem exceção (seguranca-multitenant.md).
6. Colunas privilegiadas: guard trigger BEFORE UPDATE bloqueia alteração por sessão authenticated; service role (Edge Functions) bypassa. Estender o guard ao adicionar colunas sensíveis.
7. Backfill: sempre com where ... is null e validação de contagem.
8. FK composta por tenant: quando uma entidade referencia outra do mesmo tenant, usar FK composta (tenant_id, ref_id) -> (tenant_id, id).
9. Testes: toda migration validada por supabase db reset (local) + testes de integração (RLS/guard).
10. Ordem: migrations aplicadas em ordem cronológica pelo timestamp. Não renomear migration já aplicada em produção.
11. Sem H2: testes de integração usam PostgreSQL real. Nunca H2.
12. Dinheiro/tempo: *_cents inteiro; timestamps timestamptz (UTC).

## Convenções de SQL

- Tabelas/colunas: inglês, snake_case, tabelas no plural.
- Índices: {tabela}_{colunas}_idx.
- Policies: {tabela}_{acao}_{escopo}.
- Triggers: {tabela}_{acao}.
- Funções helper: current_{nome}() security definer com search_path fixo.

## Anti-padrões

- Alterar migration já aplicada em produção.
- Criar tabela de domínio sem tenant_id/RLS.
- Enviar tenant_id como filtro do cliente.
- Usar deleteAll em testes.
