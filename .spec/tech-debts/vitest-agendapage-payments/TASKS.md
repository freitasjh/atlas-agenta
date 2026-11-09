# DÉBITO TÉCNICO — vitest-agendapage-payments (P1)

## Contexto
`npm test`: `AgendaPage.payments.test.tsx:345` — `Unable to find role button "Abrir pagamento do atendimento"` após clicar "Semana". Detectado no harness do débito `bootstrap-operator-backfill` (2026-11-09). Arquivo fora do diff daquele débito → classificado H2 pré-existente, não bloqueou o ciclo (override registrado em workflow-state.json).

## Classificação
P1 — suite completa deve voltar a 0 falhas (H2 zero tolerância) antes do próximo dev no domínio agenda/pagamentos.

## Investigar
- Render condicional do botão "Abrir pagamento" vs filtro "Semana" (mudança de comportamento pós grade-horários/cobrança?).
- Mock de dados vs cascata vigência→override→grade (feriado/folga no dataset?).

## Aceite
- `npm test` 903/903 (ou contagem vigente) 0 falhas, sem skip novo.
