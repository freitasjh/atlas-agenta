# TASKS — grade-horarios-profissionais (TDD) — revisado PM

## FE-01 deriveMonthlyGrade pura (P0)
- [x] Teste: vigência nula=aberta, fim datado, override fecha/atípico, weekday sem grade, multi-faixa união, DST SP, passado sem slot, mensal==useAvailableSlots, edição retroativa bloqueada (save com vigência passada bloqueado, count appointments inalterado).
- [x] Implementar src/app/config/profissionais/horarios/deriveMonthlyGrade.ts (pura, Intl tz tenant).

## FE-02 WeekScheduleForm lote (P0)
- [x] Teste: preset Seg–Sex 08–18 (alinha SPEC) aplica lote em ≤4 interações; copiar dia→selecionados; fim semana 9–14; diff sticky "N dias alterados"; 1 faixa/dia; erro início≥fim inline pt-BR.
- [x] Teste NEW PM-1/2: batch falha parcial → rollback total (semana prévia restaurada), retry idempotente mesmo payload, 23505→pt-BR; batch × appointment futuro → APPOINTMENT_CONFLICT_FUTURE 409 pt-BR + rollback (forall futuro).
- [x] Implementar presets+checkbox+copiar+FDS+sticky + TX lote (RPC ADR-02 quando backend; em MVP transação cliente + rollback).

## FE-03 MonthlyGradeView read-only (P0)
- [x] Teste: badge textual (9–18/FOLGA/ATÍPICO/CONFLITO) + cor, legenda, navegação mês, header vigência, Skeleton/Empty/Error, aria-label dia completo, mobile setas 360px sem scroll, performance ≤3s com dataset definido.
- [x] Teste NEGATIVO: nenhuma célula edita grade; único caminho de exceção = Dialog (FE-04) com label claro.
- [x] Implementar MonthlyGradeView.tsx.

## FE-04 Exceção Dialog calendário (P0)
- [x] Teste: folga sáb já livre / feriado dia útil sem erro; atípico sáb 09–13 só nesse intervalo; override vence grade; reason vazio→null; validação inline; exceção ≤6 interações; conflito com appointment futuro E passado ativo → bloqueia + Alert âmbar + preserva agendamento.
- [x] Implementar OverrideFormDialog aberto do dia (Tabs folga/atípico, ≤6 campos).

## FE-05 RBAC + i18n + a11y (P0 — elevado pelo PM)
- [x] Teste: receptionist/prof outro tenant UI disabled + API 403; tenant_id forjado ignorado; assinatura bloqueado/cancelado nega escrita operacional; reason não-PII (tel/documento não loga); query escopada por profissional+mês; varredura strings hardcoded; Tab/Enter/Esc, foco visível, NVDA dia+erro.
- [x] Implementar disabled/readOnly + i18n pt-BR + a11y WCAG 2.1 AA.

## VAL-01 Harness (P0)
- [x] vitest + typecheck + Chrome DevTools (Network 2xx sem duplicada, Console 0 error, 404=0) + screenshot + i18n ✅; REVISION_STALE marcado explicitamente como fora-MVP.
