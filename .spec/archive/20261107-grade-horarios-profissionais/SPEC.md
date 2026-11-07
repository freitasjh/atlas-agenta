# SPEC — grade-horarios-profissionais (frontend)

## 1 Visão
Template semanal em lote + calendário mensal read-only derivado + exceções pontuais. Sem tabela nova. `working_hours` fonte recorrente, `schedule_overrides` 1/dia, vigência em `professionals`. Slots = função pura sem materialização.

## 2 Escopo
- Entra: presets lote, copiar dia→semana, fim de semana dedicado, MonthlyGradeView read-only (badge textual), Dialog exceção (folga/atípico), validação prévia conflito, 1 faixa/dia UI, mobile 360px, a11y WCAG 2.1 AA, i18n pt-BR.
- Fora: mensal editável, materialização, multi-faixa UI, feriado tenant, GCal, auto-agendamento, realtime, drag&drop.

## 3 Regras
- Cascata: vigência → override → grade. Override fecha/atípico ignora grade do weekday.
- Grade nova nunca apaga/move appointment; edição retroativa bloqueada.
- Conflito grade nova × appointment futuro ativo → bloqueia save (forall futuro), mensagem pt-BR.
- RBAC/RLS: admin qualquer prof. tenant; professional só próprio; receptionist só leitura; tenant_id JWT.
- Assinatura bloqueado/cancelado bloqueia escrita operacional.
- 1 save = 7 dias = 1 TX (RPC recomendado; delete+insert não-atômico é risco conhecido).
- schedule_revision futuro para concorrência otimista (ADR-03).

## 4 Interfaces congeladas
- deriveMonthlyGrade(grade, overrides, vigencia, mês, tz) → DayGrade[] (pura cliente).
- working_hours / schedule_overrides contratos intactos; appointments_no_overlap intacta.
- Erros pt-BR: APPOINTMENT_CONFLICT_FUTURE, REVISION_STALE, 23505→pt-BR.

## 5 Aceite (Given/When/Then)
1. Lote Seg–Sex 08–18: salva com sáb/dom livres → slots só Seg–Sex; mensal mostra dias livres.
2. Mensal read-only: grade salva → exibe grade+exceções+vigência; nenhuma célula editável por este caminho.
3. Folga em sábado já livre / feriado em dia útil → dia indisponível, sem erro, sem tocar outros dias.
4. Atípico sáb 09–13 com sáb off → slots só 09–13; override vence grade.
5. Mudança vigência futura → agendamentos passados intactos.
6. Override removendo horário com appointment passado/futuro ativo → bloqueia com pt-BR, preserva agendamento.
7. Recepção/prof. outro tenant tenta editar → UI esconde + API/RLS 403; bloqueado/cancelado nega escrita.
8. UX: Seg–Sex em ≤4 interações; mensal legível ≤3s; exceção ≤6 cliques; conflito bloqueia silencioso; mobile 360px sem scroll horizontal; teclado+NVDA completos.

## 6 Riscos & testes
- RLS cross-tenant, receptionist write negado, professional edit outro negado, tenant_id forjado ignorado.
- Slots/derivada: override fechado/atípico, bordas vigência, DST fuso tenant, multi-faixa união, mensal == useAvailableSlots por dia.
- Conflito, batch rollback total, idempotência.

## 7 Delta Specs
- ADDED: MonthlyGradeView (frontend read-only derivada), presets lote WeekScheduleForm.
- MODIFIED: WeekScheduleForm (lote semanal), ScheduleOverridesSection (entrada via calendário Dialog).
- REMOVED: nenhuma tabela/coluna no MVP (schedule_revision = ADR futuro, migration aditiva separada).
- Docs: .agents/rules/dominio.md (grade), .agents/rules/stack.md (frontend telas) — merge no archive.

## 8 Security (Fase 1)
STRIDE: Elevation (IDOR grade alheia) → RLS+RBAC; Tampering (tenant_id forjado) → current_tenant_id(); Info Disclosure (reason / PII) → reason não-PII, erro genérico; DoS → query por profissional+mês, sem escalar tenant inteiro.
Veredito: pass (gaps 0 🔴). Backlog: RPC atômico + revision (ADR-02/03) fecha race/atominidade.
