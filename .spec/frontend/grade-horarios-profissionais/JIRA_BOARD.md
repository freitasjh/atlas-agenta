# JIRA_BOARD — grade-horarios-profissionais (EPIC)

| Key | Layer | Status | Aceite |
|---|---|---|---|
| GRADE-FE-01 | FE | done | derive mensal == slots; tabela verdade A4 (vigência/override/break/bordas/DST) 25/25 |
| GRADE-FE-02 | FE | done | lote ≤4 interações; rollback checado+retry+snapshot (C3) 5/5; batch×override A1; refetch C2 |
| GRADE-FE-03 | FE | done | mensal legível ≤3s; blanks seg→dom + lista/botão real + 360px sem scroll (C1) 9/9 |
| GRADE-FE-04 | FE | done | exceção ≤6 cliques + conflito bloqueia (refetch C2); reason A3 |
| GRADE-FE-05 | FE | done | RBAC render disabled/bloqueado, Tab/lente, select leve/escopo; isRetroactiveEditBlocked plugado (A2) |
| GRADE-VAL-01 | VAL | done | typecheck 0 erros + build 0 erros + suite 815/815 (97 arquivos); harness Chrome pendente (infra local) |

## Code review loop 1/3 — correções aplicadas (2026-11-07)

- 🔴 C1 MonthlyGradeView: blanks `(wd+6)%7`, sem `min-w-[560px]`/scroll, `<ul>`+`<li>`+`<button>` real, headers `aria-hidden`, aria-label dia completo mantido.
- 🔴 C2 stale cache: `await refetch()` antes de `findOverrideConflict`/`findBatchConflicts` + submit disabled com `isFetching` (OverrideFormDialog/WeekScheduleForm).
- 🔴 C3 rollback: erros checados, retry 1x, erro explícito com snapshot + `console.error` (`WORKING_HOURS_ROLLBACK_FAILED_MESSAGE`).
- 🟡 A1 `findBatchConflicts` cascata override; horizonte 60d documentado (SPEC).
- 🟡 A2 `isRetroactiveEditBlocked` plugado em ScheduleValidityForm (erro inline + toast, sem save).
- 🟡 A3 heurística PII: parênteses `(DDD)` + número contínuo 9–14 dígitos; datas hífen não casam.
- 🟡 A4 tabela verdade (~11 casos novos): vigência inclusiva, folga/atípico em dia livre, mensal==slots atípico, bordas de janela, parede/DST, fronteira de "agora".
- 🟡 A5 provas: disabled/bloqueado render, Tab/lente (botão nativo + `focus-visible` + aria-label), select leve + `eq(professional_id)` sem `tenant_id`; RLS/403 é trava de banco (migrations) — FE nunca envia `tenant_id` (assertado no payload do save e no filtro).
- 🟡 A6 `useAppointmentActivityRange` (colunas leves) em conflito/contagem; `todayInTimeZone`/`tenantDayOfUtc` (fuso tenant, não UTC); `useWatch` memoizado; `enabled: open` no dialog.
- 🟡 A7 Select shadcn no "Copiar dia" (sem `<select>` nativo visível, Label único via `htmlFor`).

## Exceções registradas (A7 i18n)

- **i18n sem react-i18next**: o projeto não tem infra i18n (`src/i18n/` inexistente, sem `react-i18next` nas dependências); a convenção vigente é literais pt-BR + módulos `*-messages.ts` pontuais. Introduzir i18n é feature nova (fora do escopo: "sem código de outras features"). Quando existir, migrar as strings destes componentes para `t()`.
- **TASKS.md checkboxes**: arquivo do orchestrator (regra do developer: não edita SPEC/PLAN/TASKS/workflow-state) — checkboxes reais em `.spec/frontend/grade-horarios-profissionais/TASKS.md` pendentes de marcação pelo orchestrator.
