# ADR-09 — Relatórios de retenção (F): backend (RPCs e métricas)

- Status: proposto

## Contexto

Capacidade F exige hub estendido + 3 páginas com no-show rate, rebooking rate, utilização de agenda, ticket médio e retenção por coorte (RF-31..RF-34). Métricas calculadas via RPC; admin only. Export CSV pode ser client-side a partir do resultado da RPC.

## Decisão

1. RPCs (admin only, RLS/role check):
   - `report_noshow_rate(period, professional_id, service_id)` → atendimentos `nao_compareceu` ÷ (concluídos + confirmados + não compareceu).
   - `report_rebooking_rate(period, ...)` → clientes com ≥2 visitas no período ÷ clientes ativos.
   - `report_utilization(period, ...)` → minutos ocupados ÷ minutos disponíveis (agenda profissional) por profissional/serviço.
   - `report_ticket_medio(period, ...)` → sum(price_cents - discount?) ÷ atendimentos concluídos; admin only.
   - `report_cohort_retention(cohort_month, window_days)` → clientes da coorte com visita na janela.
   - `report_retention_summary(period)` → agregado para cards do hub.
2. Filtros por período/profissional/serviço; paginação/limites.
3. RBAC: apenas admin; receptionist/professional recebem erro de permissão (não dados vazios).
4. Performance: índices existentes de appointments; RPCs usam agregações SQL; evitar N+1.
5. Export CSV: frontend gera CSV a partir do JSON retornado; sem endpoint novo.
6. Acessibilidade é responsabilidade da UI (ADR-17).

## Consequências

- Positivas: métricas orientadas à decisão; reuso de dados existentes.
- Negativas/risco: definições de coorte/janela precisam ser fechadas (pergunta 11); custo de agregação em períodos grandes (mitigar limites).
- Defaults PRD §7: cents/UTC; admin only.

## Escopo

Entra: migrations/RPCs, testes de permissão/performance. Não entra: UI, gráficos, campanhas.

## Arquivos afetados

- `supabase/migrations/<timestamp>_retention_reports_rpcs.sql`
- Testes de integração (RBAC/permissão)

## Critérios de aceite (testáveis)

1. RPCs retornam métricas corretas para fixtures conhecidas.
2. Receptionist/professional recebem erro de permissão.
3. Filtros alteram resultado.
4. Performance aceitável para período de 90 dias (teste de tempo).

## Dependência

- ADR-01 (não direta; relatórios não têm chave própria)
- ADR-08 (CRM fornece tags/segmento para filtros)
