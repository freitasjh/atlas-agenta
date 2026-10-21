# ADR-07 — Vigência e exceções na tela de horários (`HorariosPage`)

**Status:** proposto

## Contexto

A tela `/app/config/profissionais/:profissionalId/horarios` (`HorariosPage` + `WeekScheduleForm` +
`DayRow`) já edita a grade semanal recorrente. A feature (PRD §2.2, análise frontend §2.2) adiciona
**duas seções novas abaixo da grade**, reusando a mesma página e o mesmo padrão de RBAC/leitura:

- **Vigência** (`ScheduleValidityForm`): "Atende a partir de" / "Atende até" (datas; fim opcional via
  switch "Sem data de término") + o passo-base (`slot_step_minutes`). Salva as colunas de
  `professionals` via `useUpdateScheduleValidity` (ADR-04). **Admin-only no MVP** (ADR-01 / PRD §9
  ponto 3): o `professional` vê em leitura.
- **Exceções por data** (`ScheduleOverridesSection` + `OverrideFormDialog` + `OverrideItem`): lista as
  exceções do profissional e permite criar/editar/remover folga (`is_closed=true`) ou horário atípico
  (`is_closed=false`, janela + break opcional, reusando a ergonomia de `DayRow`). Usa
  `useScheduleOverrides`/`useUpsertScheduleOverride`/`useDeleteScheduleOverride` (ADR-04).

O RBAC de leitura/edição **espelha o da grade** já implementado em `HorariosPage` (`canEditAnySchedule
|| (canEditOwnSchedule && isOwnSchedule)`): admin edita qualquer; professional edita só a própria
(exceções); receptionist e professional-em-grade-de-outro veem em **leitura** (sem botões de salvar).
A vigência/passo é admin-only, então para professional a seção de vigência aparece em leitura mesmo na
própria grade. A trava real é o RLS (ADR-01/02); a UI é defesa em profundidade.

Formulários com react-hook-form + resolver zod (`scheduleValiditySchema`/`scheduleOverrideSchema` de
ADR-03), mensagens pt-BR. Erro de data duplicada → "Já existe uma exceção para esta data." (ADR-04).
Copy e tokens conforme análise frontend §6/§3.2. Toasts no padrão existente ("Vigência salva.",
"Exceção salva.", "Exceção removida.").

## Decisão

1. Criar os componentes em `src/app/config/profissionais/horarios/`:
   - `ScheduleValidityForm.tsx` — form de vigência + passo-base; `readOnly` quando o papel não pode
     (admin-only); usa `useScheduleValidity`/`useUpdateScheduleValidity`.
   - `ScheduleOverridesSection.tsx` — lista + botão "Adicionar exceção"; `readOnly` espelhando a grade.
   - `OverrideFormDialog.tsx` — diálogo criar/editar exceção (data, tipo folga/horário-atípico, janela
     + break quando atípico), reusando a lógica de janela de `DayRow`/`workingHoursDaySchema`.
   - `OverrideItem.tsx` — item com badge de tipo e ações editar/remover.
2. Editar `HorariosPage.tsx`: montar as duas seções **abaixo** do `WeekScheduleForm`, passando o
   `professionalId`, o `readOnly` da grade (para exceções) e um `readOnly` admin-only (para vigência).
   Não alterar o comportamento atual da grade (AC-20).

Nenhuma mudança na grade semanal, no roteamento ou nos guards de `/app` (herdados).

## Consequências

- **Positivas:** clínicas registram folga/feriado/horário atípico e o período de atendimento; reuso
  total da página, do RBAC e da ergonomia de janela.
- **Custos/limitações:** professional não edita a própria vigência/passo no MVP (admin-only, por
  design); uma exceção por data (sem múltiplas faixas no mesmo dia).
- **Risco controlado:** RLS barra escrita indevida; a UI só esconde/desabilita.

### Escopo

Frontend.

### Arquivos / pastas afetados

- `src/app/config/profissionais/horarios/ScheduleValidityForm.tsx` (novo).
- `src/app/config/profissionais/horarios/ScheduleOverridesSection.tsx` (novo).
- `src/app/config/profissionais/horarios/OverrideFormDialog.tsx` (novo).
- `src/app/config/profissionais/horarios/OverrideItem.tsx` (novo).
- `src/app/config/profissionais/horarios/HorariosPage.tsx` (editar).

### Critérios de aceite testáveis (desta ADR)

QA ao vivo em `/app/config/profissionais/:id/horarios` (tenant autenticado; `supabase start`;
`npm run dev`; chrome-devtools):

- **AC-10/11 (dados por trás, verificados pela UI):** marcar um dia como folga faz os slots daquele
  dia sumirem (confirmado em `/app/agenda` via ADR-06); horário atípico muda a janela do dia.
- **Vigência:** salvar início/fim reflete nos slots (fora da vigência → sem slots, AC-12); switch "Sem
  data de término" grava `schedule_end_date = null`; passo-base salvo altera a granularidade dos chips.
- **Unicidade:** tentar criar uma segunda exceção para a mesma data mostra "Já existe uma exceção para
  esta data." (AC-07 na borda).
- **RBAC/leitura (PRD §8 item 6/9):** `receptionist` e `professional` na grade de outro veem as seções
  em **leitura** (sem botões de salvar); `professional` na própria grade edita exceções mas vê a
  vigência em leitura (admin-only); nenhum dado financeiro aparece.
- **Não-regressão:** a grade semanal continua salvando igual (AC-20).
- **Verificação:** `npm run typecheck` e `npm run build` limpos; QA visual conforme PRD §8 item 6.

### Dependência

Depende de **ADR-03** (schemas/tipos) e **ADR-04** (hooks de exceção/vigência). Independente de
ADR-06 e ADR-08. Para o QA ao vivo, as migrations ADR-01/02 devem estar aplicadas.
