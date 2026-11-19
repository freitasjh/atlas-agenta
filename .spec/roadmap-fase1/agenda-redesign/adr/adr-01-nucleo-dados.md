# ADR-01 — Núcleo de dados da agenda (selectors + máscara RBAC)

- **Status:** proposta
- **Depende de:** nenhuma (base da série)

## Contexto

ResumoDoDia, filtros, Dia, Semana e Drawer precisam das mesmas contas (ocupação, Previsto R$, A confirmar, risco no-show). Hoje cálculo espalhado na AgendaPage. Fundador fixou: risco = fórmula simples (Q1); Previsto R$ = soma `price_cents` dos não-cancelados do dia (Q2). Receptionist não vê valores R$ (Q6). Regras R1/R2/R4/R5/R11 valem.

## Decisão

Criar camada pura de dados `src/app/agenda/model/` (sem UI):
- `daySummary.ts`: `computeDaySummary(appts, capacidade)` → `{ ocupacaoPct, horariosOcupados, capacidade, previstoCents, numAtendimentos, aConfirmar, riscoNoShow }`. Risco simples: `count(nao_compareceu 7d, mesmo professional?) + count(sem opt-in)` — documentar fórmula no código, sem ML.
- `maskFinancials(role)`: receptionist → `previstoCents=null`, cards sem R$.
- Reuso de tipos/queries existentes; nenhuma migration; nenhuma chamada nova (opera sobre lista já buscada, RLS intacta).

## Consequências

- Pró: conta única testável, telas viram apresentação; RBAC centralizado.
- Contra: capacidade (denominador ocupação) precisa de fonte (working_hours do dia) — se ausente, degradar para "N agendados" sem %.

## Escopo

- Arquivos afetados: `src/app/agenda/model/daySummary.ts` (novo), `src/app/agenda/model/financialMask.ts` (novo), `*.test.ts` novos.
- Fora de escopo: qualquer JSX, DnD, Drawer, gating, WhatsApp.

## Critérios de aceite (testáveis)

- [ ] `computeDaySummary` com fixture 10 agendados / capacidade 20 → 50% + "10 de 20".
- [ ] Previsto = soma `price_cents` onde `status != cancelado` (inclui pendente/confirmado/em_atendimento/concluido/nao_compareceu).
- [ ] Cancelado excluído; `price_cents null` tratado como 0.
- [ ] Receptionist recebe `previstoCents=null`; admin/professional recebem valor.
- [ ] `vitest run` verde nos novos testes.
