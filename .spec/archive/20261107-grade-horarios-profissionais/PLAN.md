# PLAN — grade-horarios-profissionais

## Estratégia
Frontend-only MVP. Reusar WeekScheduleForm/OverrideFormDialog/scheduling-slots/datetime. Nova MonthlyGradeView read-only. Batch semanal 1 TX (RPC ADR-02 futuro ou transação cliente imediata). Sem migração MVP.

## Fases
1. Base pura: deriveMonthlyGrade() + testes (vigência→override→grade, DST, multi-faixa união).
2. WeekScheduleForm lote: presets (Seg–Sex 9–18, com almoço, Ter–Sáb), checkbox dia, copiar para selecionados, fim de semana dedicado, sticky diff, 1 faixa/dia.
3. MonthlyGradeView: header vigência, cards template+mensal+exceção, badge textual+cor (nunca só cor), navegação mês, incluir appointment count, mobile setas, Skeleton/Empty/Error.
4. Exceção via Dialog no calendário: tipo folga/atípico, reason null quando vazio, validação inline, conflito com appointment futuro → Alert bloqueia save.
5. RBAC/RLS matrix + harness: vitest, typecheck, Chrome harness (rede/console/screenshot), i18n pt-BR.

## Restrições
- working_hours intacto, overrides 1/dia unique, appointments_no_overlap intacta.
- Sem editar backend/DB; RPC ADR-02/03/04 como follow-up se race comprovado.
- Testes: mensal == useAvailableSlots por dia (property).

## Fail modes
- Save não-atômico (delete+insert) → rollback total exigido.
- Concorrência → 409 REVISION_STALE (quando revision existir).
- Overlap grade nova × appointment → 409 com datas, mensagem pt-BR.
