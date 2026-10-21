# ADR-06 — SlotPicker no fluxo de criação (`AppointmentFormDialog`)

**Status:** proposto

## Contexto

Hoje o `AppointmentFormDialog` (`src/app/agenda/AppointmentFormDialog.tsx`) usa um `<input
type="time">` cru para o horário de início: o operador digita qualquer hora, e só a checagem local
(`hasLocalConflict`) + a constraint do banco impedem erro. A feature (RF-AG-05 / PRD §2.2) troca esse
input por um **seletor de slots livres** (chips), gerado sob demanda a partir de profissional +
serviço + dia pelo `useAvailableSlots` (ADR-05). Término e valor continuam derivados do serviço
exatamente como hoje (read-only). Nenhuma mudança no `appointmentSchema` (o `SlotPicker` escreve no
campo `time` existente — análise frontend §4.4).

Comportamento (análise frontend §2.3):

- enquanto profissional + serviço + data não estão escolhidos, o picker mostra um estado guia;
- com os três definidos, dispara a query de slots e renderiza chips; a duração do serviço já filtra o
  que cabe (ADR-05);
- selecionar um chip preenche o `time` do form; término/valor derivados aparecem como hoje;
- **edição:** o `SlotPicker` recebe o `appointmentId` em edição para excluir o próprio ocupante do
  desconto (espelha o que `hasLocalConflict` já faz);
- dois caminhos convergem no mesmo submit: botão "Novo agendamento" e clique numa faixa vazia do
  calendário (ADR-08) que pré-preenche profissional + data + início.

Estados vazios específicos (copy pt-BR, análise frontend §3.4/§6): sem slots por serviço ("Nenhum
horário livre para este serviço neste dia."), folga ("O profissional não atende nesta data."), fora
de vigência ("Fora do período de atendimento do profissional."), sem grade ("Este profissional ainda
não tem grade de horários." + link para configurar quando o papel permite).

A checagem local e a constraint do banco **permanecem** — os slots reduzem erro mas não substituem a
trava (corrida ainda cai na constraint com a mesma mensagem pt-BR via `mapSchedulingError`, AC-18).

Acessibilidade (análise frontend §5): o grupo de chips é um `radiogroup` (`role="radiogroup"` +
`aria-label="Horários livres"`, chips como `radio`), foco visível, `Enter`/`Espaço` selecionam; slot
indisponível é **omitido**, não renderizado desabilitado.

## Decisão

1. Criar `src/app/agenda/SlotPicker.tsx`: componente controlado que recebe os slots já calculados
   (via `useAvailableSlots`) + o estado de carregamento/erro/vazio e o motivo do vazio (folga /
   fora-de-vigência / sem-grade / sem-slots), e emite o início escolhido. Renderiza chips com
   `Button variant="outline"` + estado selecionado (`bg-primary`), como `radiogroup`. Skeleton de
   6–8 chips em carregamento (`aria-busy`).

2. Editar `AppointmentFormDialog.tsx`: substituir o `<input type="time">` pelo `SlotPicker`,
   alimentado por `useAvailableSlots({ professionalId, serviceId, day, appointmentId })`. Passar o
   `appointmentId` em edição. Manter: derivações read-only (término/valor), `hasLocalConflict`, o
   submit e o tratamento de `mapSchedulingError`. A seleção de um chip faz `form.setValue("time", ...)`.
   Aceitar props de pré-preenchimento (profissional + início) para o caminho "faixa vazia" de ADR-08.

Nenhuma mudança em `appointmentSchema` nem no contrato de `useCreateAppointment`/`useUpdateAppointment`.

## Consequências

- **Positivas:** marcação a partir de horários válidos (menos erro), mantendo término/valor e a trava
  do banco; reuso do diálogo e do schema.
- **Custos/limitações:** o diálogo passa a depender de profissional+serviço+dia antes de ofertar
  horário (fluxo mais guiado — intencional).
- **Risco controlado:** constraint do banco inalterada; AC-18 garante a mensagem pt-BR em corrida.

### Escopo

Frontend.

### Arquivos / pastas afetados

- `src/app/agenda/SlotPicker.tsx` (novo).
- `src/app/agenda/AppointmentFormDialog.tsx` (editar).

### Critérios de aceite testáveis (desta ADR)

QA ao vivo em `/app/agenda` (tenant autenticado; `supabase start`; `npm run dev`; chrome-devtools):

- **AC-18:** criar a partir de um chip preenche profissional/serviço/início e cria; em corrida, a
  constraint (23P01) barra a sobreposição com a **mesma** mensagem pt-BR (`mapSchedulingError`).
- **Slots refletem tudo (visível pela UI, lógica provada em ADR-05):** serviço de 1h → chips de 30 em
  30 que caibam 1h e não sobreponham ocupados; 2h reduz as opções; dia em folga → "O profissional não
  atende nesta data." e nenhum chip; fora da vigência → "Fora do período de atendimento do
  profissional."; sem grade → "Este profissional ainda não tem grade de horários."
- **Edição:** ao editar, o slot ocupado pelo próprio agendamento permanece ofertável.
- **Acessibilidade observável:** foco visível ao tabular pelos chips; grupo anunciado como
  `radiogroup`; indisponível omitido.
- **Verificação:** `npm run typecheck` e `npm run build` limpos; QA visual conforme PRD §8 itens 3–5 e
  8.

### Dependência

Depende de **ADR-05** (`useAvailableSlots`/gerador) e, por extensão, ADR-01..04. Independente de
ADR-07 e ADR-08 (que só reusam este diálogo e o picker).
