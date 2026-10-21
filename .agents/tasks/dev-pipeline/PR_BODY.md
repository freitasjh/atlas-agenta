# feat(agenda): slots sob demanda, exceções/vigência e visão de calendário

**Branch:** `feat/adr-06-slotpicker` (empurrada para `origin`)
**Compare/abrir PR:** https://github.com/freitasjh/atlas-agenta/pull/new/feat/adr-06-slotpicker

## Resumo

Evolui o módulo de agenda por profissional:

- **Vigência da grade** (`schedule_start_date`/`schedule_end_date`) e **passo-base de slots**
  (`slot_step_minutes`) por profissional, novas colunas em `professionals`.
- **Exceções por data** (folga/feriado/horário atípico) em nova tabela multi-tenant
  `schedule_overrides`, com RLS/RBAC (admin escreve tudo no tenant; profissional só a própria).
- **Geração de slots sob demanda** (`src/lib/scheduling-slots.ts`, puro e testado): grade semanal
  − exceções − vigência − agendamentos ocupados, com o encaixe consumindo a **duração do serviço**
  escolhido a partir de um início válido, no **fuso do tenant**. Nada materializado.
- **SlotPicker** no fluxo de criação (`AppointmentFormDialog`): escolhe um horário livre; manter a
  não-sobreposição (constraint `tstzrange` no banco, erro 23P01 em pt-BR na corrida).
- **Tela de horários** (`HorariosPage`) ganha vigência + exceções, reusando a grade semanal.
- **AgendaPage** ganha **visão de calendário (dia/semana) alternável com a lista** por escolha do
  usuário (toggle na própria tela, não config de tenant).

## ADRs entregues

- **adr-01** — Vigência da grade e passo-base de slots em professionals
- **adr-02** — Tabela schedule_overrides (exceções por data) com RLS/RBAC
- **adr-03** — Tipos de domínio e schemas zod de exceção/vigência
- **adr-04** — Hooks de dados: exceções e vigência/passo
- **adr-05** — Gerador de slots puro (lib/scheduling-slots.ts) e useAvailableSlots
- **adr-06** — SlotPicker no fluxo de criação (AppointmentFormDialog)
- **adr-07** — Vigência e exceções na tela de horários (HorariosPage)
- **adr-08** — Visão de calendário (dia/semana) alternável com a lista (AgendaPage)

## O que foi testado

- `npm run build` (tsc -b && vite build): **limpo** (único aviso é chunk >500kB, pré-existente).
- `npm test` (vitest): **16/16** em `scheduling-slots.test.ts` — grade, break, exceção
  fechada/janela atípica, vigência início/fim, ocupados, duração do serviço consumindo o bloco,
  passo-base e **DST real**.
- **DB ao vivo** (psql no container local): `schedule_overrides` com `tenant_id` DEFAULT
  `current_tenant_id()`, RLS habilitado, 3 políticas (select same-tenant; write admin; write
  own-professional via `profile_id = auth.uid()`), FK composto `(tenant_id, professional_id)`,
  unique por data, CHECKs (fechado vs. janela com break both-or-none). `professionals` com as 3
  colunas novas e RLS. Confirma ADR-01/02 ao vivo.
- Fiação de frontend (source + typecheck): SlotPicker, useAvailableSlots, useScheduleOverrides,
  scheduling-slots e AgendaPage presentes e integrados.

## Itens pendentes

- **QA visual ao vivo via chrome-devtools PENDENTE:** a ferramenta MCP chrome-devtools não está
  exposta ao step de entrega. A verificação visual consolidada no `/app/agenda` (chips de slot
  refletindo grade/exceção/vigência/ocupados no fuso do tenant; estados de vazio; toggle
  calendário↔lista dia/semana; criar a partir de um chip sem sobreposição) deve ser feita antes do
  merge. Nada falhou na verificação estática/DB — a visual apenas não pôde rodar aqui.
- **Abertura do PR:** branch já empurrada; abrir pela compare URL acima ou autenticar um `gh`/`glab`
  (nenhum CLI de forge disponível no ambiente deste step).
- Confirmar a branch-base de merge (`master` ou branch empilhada).
