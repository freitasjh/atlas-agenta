# ADR-08 — Visão de calendário (dia/semana) alternável com a lista (`AgendaPage`)

**Status:** proposto

## Contexto

Hoje a `AgendaPage` (`src/app/agenda/AgendaPage.tsx`) é uma **lista vertical** por profissional/dia.
O usuário pediu (mensagens 11.3 e 12.1) **trocar por uma visão de calendário, mantendo a lista atual
como opção, configurável por usuário**. A feature (RF-AG-06 / PRD §2.2, análise frontend §2) adiciona
um **toggle Lista · Dia · Semana** cuja preferência persiste **por usuário** em `localStorage` (nunca
config de tenant, AC-19), com a lista como default no mobile. As visões de calendário desenham blocos
proporcionais à duração, borda-lateral da cor do status (reuso de `STATUS_BORDER`/`StatusBadge`), e
permitem **criar a partir de clique numa faixa vazia** (que pré-preenche profissional + início no
`AppointmentFormDialog` de ADR-06).

Componentes novos (análise frontend §2.2), em `src/app/agenda/`:

- `AgendaViewToggle.tsx` — alternador segmentado; estado local + `localStorage` por usuário; teclado
  por setas, `aria-pressed`.
- `AgendaCalendarDay.tsx` — visão dia: calha de horas (tabular-nums), faixa de expediente distinta da
  faixa sem expediente, **linha do agora** em jade (`bg-primary`) quando o dia é hoje; colunas por
  profissional quando admin/recepção veem "todos"; faixa vazia clicável (role `button`, `aria-label`
  "Criar agendamento às HH:MM").
- `AgendaCalendarWeek.tsx` — visão semana: 7 colunas (segunda→domingo, ordem de `DISPLAY_ORDER`); no
  mobile degrada para dia navegável por setas.
- `AppointmentBlock.tsx` — bloco visual de um agendamento (extrai a parte visual do `AgendaItem`
  atual; o `AgendaItem` da lista permanece).

Reuso (não reescrever): `useAppointments` (mesma query do dia, sem request novo — a lista e o
calendário compartilham a chave), `STATUS_BORDER`, `StatusBadge`, `formatTimeInTenantTz`/`datetime.ts`
para o fuso (AC-16), `usePermissions` para RBAC, `StatePanel`/`PageHeader`. Para o clique em faixa
vazia, só renderizar faixas livres a partir de `useAvailableSlots` (ADR-05) quando houver
profissional+serviço no contexto; na ausência de serviço, a faixa vazia abre o diálogo já com
profissional+início e o usuário escolhe o serviço (o picker recalcula).

Acessibilidade (análise frontend §5): a linha do agora é decoração (o horário nunca depende só de
cor); folga/sem-expediente têm rótulo textual; blocos focáveis abrem o mesmo menu de ações da lista;
faixa vazia alcançável por teclado; `prefers-reduced-motion` respeitado (já global). Mobile-first
(RNF02): default Lista; janela de horas renderizada só do primeiro ao último expediente, não 00–24.

Guards e RBAC herdados de `/app`/`AppLayout` e `usePermissions` — **não** recriados. `professional`
vê só a própria agenda (filtro some, como hoje); admin/recepção veem todos. Nenhum dado financeiro na
tela. Esta é a última ADR; fecha a feature e a não-regressão (AC-20).

## Decisão

1. Criar `AgendaViewToggle.tsx`, `AgendaCalendarDay.tsx`, `AgendaCalendarWeek.tsx` e
   `AppointmentBlock.tsx` em `src/app/agenda/`, conforme acima, reusando tokens/componentes existentes
   e sem criar tokens de cor novos (faixa sem-expediente/folga por opacidade de `--muted`).
2. Editar `AgendaPage.tsx` para: ler/gravar a preferência de visão em `localStorage` por usuário
   (chave estável, p.ex. `atlas:agenda-view`); renderizar lista/dia/semana conforme a escolha sem
   recarregar; manter a lista atual intacta como uma das visões (default no mobile); ligar o clique em
   faixa vazia ao `AppointmentFormDialog` com pré-preenchimento (props adicionadas em ADR-06).
3. Extrair a parte visual do bloco do `AgendaItem` para `AppointmentBlock.tsx` reusável, sem alterar o
   comportamento da lista.

Nenhuma rota nova; nenhum guard tocado.

## Consequências

- **Positivas:** leitura da agenda mais rápida (calendário) com a lista preservada; criação por clique
  no calendário; preferência por usuário sem config de tenant.
- **Custos/limitações:** a semana no mobile é dia-navegável (7 colunas não cabem em 360px); a oferta de
  faixa vazia depende do contexto de serviço (recalculada no diálogo).
- **Risco controlado:** mesma query de dados (sem waterfall, RNF01); fuso concentrado em `datetime.ts`.

### Escopo

Frontend.

### Arquivos / pastas afetados

- `src/app/agenda/AgendaViewToggle.tsx` (novo).
- `src/app/agenda/AgendaCalendarDay.tsx` (novo).
- `src/app/agenda/AgendaCalendarWeek.tsx` (novo).
- `src/app/agenda/AppointmentBlock.tsx` (novo).
- `src/app/agenda/AgendaPage.tsx` (editar).

### Critérios de aceite testáveis (desta ADR)

QA ao vivo em `/app/agenda` (tenant autenticado; `supabase start`; `npm run dev`; chrome-devtools):

- **AC-19:** alternar Lista → Dia → Semana muda a renderização sem recarregar; recarregar mantém a
  última visão (localStorage), sem flash para a lista; a preferência não vira config de tenant.
- **Calendário (PRD §8 item 2):** visão Dia com calha de horas, faixa de expediente distinta, linha do
  agora em jade quando hoje; blocos proporcionais à duração com borda da cor do status.
- **AC-16 (fuso):** agendamento às 09:00 local aparece às 09:00 no bloco, não deslocado por UTC.
- **Criar por faixa vazia (PRD §8 item 5):** clicar numa faixa vazia abre o diálogo com
  profissional+início preenchidos; o submit mantém a não-sobreposição (constraint do banco, ADR-06).
- **Responsivo/mobile (PRD §8 item 7):** 360px → default Lista; Dia usável; Semana degrada para dia
  navegável; sem overflow horizontal quebrado.
- **RBAC (PRD §8 item 9):** `professional` vê só a própria agenda; `receptionist`/`admin` veem todos;
  nenhum dado financeiro.
- **Não-regressão (AC-20):** a lista atual e o fluxo de criar/editar/mudar status seguem funcionando;
  máquina de estados e não-sobreposição intactas.
- **Verificação:** `npm run typecheck` e `npm run build` limpos; carregamento da visão default < 1,5s
  (RNF01).

### Dependência

Depende de **ADR-06** (diálogo com SlotPicker e props de pré-preenchimento) e **ADR-05**
(`useAvailableSlots` para faixas vazias). Última ADR do conjunto; consolida a feature.
