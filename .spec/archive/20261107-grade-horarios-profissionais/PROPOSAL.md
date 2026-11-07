# PROPOSAL — grade-horarios-profissionais

- Tipo: Feature/Melhoria
- Score prompt gate: 6/6 Rota B

## Problema
Editar horas dia a dia é lento (5x repetição). Grade salva sem visualização mensal. Profissional "cria agenda mensal" manualmente.

## Solução aprovada (UX+PM+Arquitetura)
1. Template semanal em lote (presets, copiar dia→semana, fim de semana dedicado) — 1 save = 7 dias.
2. Calendário mensal read-only derivado: vigência → exceção → grade (cascata pura existente).
3. Exceção pontual via Dialog no dia do calendário (folga/atípico). Override vence grade.

## Escopo
- Entra: lote semanal, mensal read-only, exceções, vigência prospectiva, RBAC/RLS existentes.
- Fora: mensal editável, materialização, multi-faixa UI, feriado tenant-wide, GCal, auto-agendamento, realtime.

## Riscos
- Save atual delete+insert não-atômico → mitigar via RPC 1 TX (ADR-02 futuro).
- Conflito grade nova × appointment futuro sem constraint → guarda RPC/recheck (ADR-04).
- Concorrência → schedule_revision otimista (ADR-03).

## Delta
Sem tabela nova no MVP. working_hours + schedule_overrides intactos. Slots função pura sem materialização.
