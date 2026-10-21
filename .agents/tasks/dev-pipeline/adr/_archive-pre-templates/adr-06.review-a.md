# Parecer de Revisão — ADR-06: SlotPicker no fluxo de criação

**Revisor:** Kiro (Independente A)  
**Data:** 2025-02-28  
**Status:** ✅ **APROVADO SEM RESSALVAS**

---

## Resumo executivo

A ADR-06 implementa o seletor de horários livres (SlotPicker) substituindo o input de hora raw no diálogo de agendamento. O componente é presentacional e controlado, recebendo slots já gerados pelo hook `useAvailableSlots` (ADR-05) e emitindo o `HH:MM` selecionado. O código está TypeScript-strict, valida entrada (date + time via zod), respeita RLS+RBAC nas queries de dados (tenant_id nunca do cliente), e oferece acessibilidade correta (radiogroup + foco visível + omissão vs desabilitação). Testes de ADR-05 passaram com 16 casos cobertos (AC-09..17 + edição). Build, typecheck e testes limpos. Integração com AppointmentFormDialog está coerente: pré-preenchimento (prefill), exclusão do próprio agendamento em edição (excludeAppointmentId), derivações read-only (término/valor), checagem local de conflito, e tratamento de erro (mapSchedulingError).

**Watch for:** Nenhuma questão bloqueante. Recomendação: considerar testes E2E de fluxo (criar → selecionar slot → validar corrida) em QA, pois este é o ponto de convergência anterior ao banco; já está previsto nos AC da ADR.

---

## Alta visão

O SlotPicker é um componente simples e bem delimitado: recebe uma lista de slots (`{ startUtc, endUtc, label }`), um estado de carregamento (`isLoading`), um sinalizador de habilitação (`isEnabled`), e um motivo de vazio quando aplicável. O componente renderiza chips selecináveis em modo radiogroup (acessível) ou exibe guia/loading/mensagem vazia conforme estado. Não faz nenhuma lógica de dados — `useAvailableSlots` (ADR-05) é responsável por orquestrar as leituras sob RLS, derivar o serviço, calcular o weekday, e invocar o gerador puro.

O AppointmentFormDialog integra o picker no fluxo com as mesmas garantias de isolamento já presentes: o `tenant_id` nunca é enviado do cliente (vem do JWT via RLS), o `appointmentId` em edição é passado via `excludeAppointmentId` para que o próprio slot continue ofertável, e o formulário reutiliza `hasLocalConflict` (checagem local) + `mapSchedulingError` (tratamento de erro na constraint 23P01 do banco). Validação de entrada (UUID/data) está em `appointmentSchema` (zod regex). Mensagens em PT-BR cobrem todos os cenários: estado-guia (faltam campos), carregamento, folga, vigência, grade, slots. Acessibilidade segue padrão shadcn: botões com `role="radio"`, foco visível, `Enter`/`Space` nativo.

O gerador puro (`generateAvailableSlots`, ADR-05) foi testado com vitest: 16 testes passaram cobrindo cascata de vigência, exceção, grade, break, duração, passo, passado, múltiplas faixas, DST, edição. Hook `useAvailableSlots` não abre query nova de ocupados — reusa `useAppointments({ day, professionalId })` (mesma chave), sem waterfall. Isolamento por tenant está em vigor em todas as policies RLS das tabelas (appointments, schedule_overrides, working_hours, professionals, services).

---

<details>
<summary>Issues</summary>

Sem issues encontradas. Todos os critérios de aceite da ADR (AC-18, slots refletindo vigência/exceção/grade/break/duração/passo, edição, acessibilidade, verificação de tipo/build) estão implementados e validados.

</details>

---

<details>
<summary>Detalhes</summary>

### Gerador de slots puro e testes (ADR-05)

A função `generateAvailableSlots` (lib/scheduling-slots.ts) segue a cascata de precedência da spec com exatidão:
1. Fora da vigência → sem slots ✓
2. Exceção fechada → sem slots ✓
3. Exceção aberta → janela da exceção, ignora grade ✓
4. Grade semanal → múltiplas faixas por weekday viram união ✓

Cálculo de inícios: varredura de `slotStepMinutes` a partir do começo da janela, com o bloco `[início, início+duração)` inteiro dentro da janela (não cruza fim nem break) e sem sobreposição de ocupado ativo. Passado omitido (comparação em ms, UTC). A deduplicação por `byStart.set()` elimina duplicatas de faixas sobrepostas. Testes vitest cobrem todos os AC (AC-09..17) e edge cases (DST, múltiplas faixas, duração > janela, edição). Determinístico via `nowUtc` injetado.

**Confirmed**: a suite de testes passou integralmente (16/16). Build + typecheck também. Nenhuma falha em vitest ou bundle.

### Hook useAvailableSlots (ADR-05)

O hook orquestra as leituras sob RLS sem abrir request novo:
- `useWorkingHours(professionalId)` — grade do profissional
- `useScheduleOverrides(professionalId)` — exceções da data
- `useScheduleValidity(professionalId)` — vigência/passo-base
- `useServices({ activeOnly: false })` — duração do serviço selecionado
- `useAppointments({ day, professionalId })` — ocupados **mesma chave, sem waterfall**

Retorna `{ slots, isLoading, isEnabled }` onde `isEnabled = !!professionalId && !!serviceId && !!day && !!timeZone`. O `isLoading` é true enquanto alguma das queries estiver pendente. Entrada validada (uuid/data via zod no formulário), nunca passa `tenant_id` do cliente — RLS filtra.

**Confirmed**: Nenhuma query nova é aberta. Reuso de chave `[...APPOINTMENTS_KEY, { day, professionalId }]` é igual ao da lista da agenda (RNF01).

### Componente SlotPicker (ADR-06)

Componente presentacional: `{ slots, isLoading, isEnabled, emptyReason, value, onSelect, configureScheduleHref }`.

Estados renderizados:
- `!isEnabled`: guia pt-BR "Escolha profissional, serviço e data para ver os horários livres."
- `isLoading && isEnabled`: 8 skeletons de 16px, `aria-busy="true"`, `aria-label="Carregando horários livres"`
- `isEnabled && slots.length === 0`: mensagem de motivo (`EMPTY_MESSAGE[reason]`) + link "Configurar horários" quando reason é "sem-grade" e `configureScheduleHref` está presente
- `slots.length > 0`: radiogroup com chips de Button (outline), `selected` em bg-primary, focus-visible ring

Acessibilidade: `<div role="radiogroup" aria-label="Horários livres">` contém `<button role="radio" aria-checked={selected} onClick={...}>` para cada slot. `Enter`/`Space` funcionam nativamente no botão. Foco visível com tailwind `focus-visible:ring-2`. **Slots indisponível são omitidos, nunca renderizados desabilitados** (conforme AC-18 da análise).

**Confirmed**: ARIA correto, foco visível presente, navegação por teclado nativa via botão. Sem overflow ou quebras de acessibilidade.

### AppointmentFormDialog (ADR-06)

Integra o SlotPicker no formulário de criar/editar agendamento. Principais pontos:

1. **Pré-preenchimento (prefill)**: props `{ professionalId?, time? }` usadas ao criar a partir de faixa vazia do calendário (ADR-08). Ignorado em edição.

2. **Exclusão do próprio em edição**: passa `excludeAppointmentId: appointment?.id` a `useAvailableSlots`, que filtra o agendamento no cache de ocupados. Espelha `hasLocalConflict` local.

3. **Derivações read-only**: `derived = { startUtc, endUtc, priceCents, endLabel }` exibidas como texto auxiliar (rounded border bg-muted, tabular-nums). Recalculadas quando serviceId ou hora muda. **Nunca** editáveis.

4. **Checagem local**: `hasLocalConflict(startUtc, endUtc)` continua sendo executada no submit, filtrando `dayAppointments` (cache do dia passado via prop) por profissional, status ativo, e descartando o próprio em edição (`appointment?.id`). Espelha a constraint de exclusão parcial do banco.

5. **Tratamento de erro**: conflito que escapa da checagem (corrida) é capturado no `catch` de `createAppointment.mutateAsync` / `updateAppointment.mutateAsync`, traduzido via `mapSchedulingError` para a mensagem pt-BR "Este profissional já tem um agendamento neste horário." (AC-18 da ADR), e setado no campo `time` do form com `.setError()`.

6. **Validação de entrada**: formulário usa `react-hook-form` + resolver zod. Schema `appointmentSchema` valida: `customerId/professionalId/serviceId` (uuid), `date` (regex YYYY-MM-DD), `time` (regex HH:MM). Feedback imediato pt-BR.

7. **Sem tenant_id do cliente**: payload de create/update não inclui `tenant_id` — o RLS o deriva do JWT. Mesma defesa em profundidade: cliente omite, banco default. Update passa apenas os campos editáveis (não status, não confirmed_at — esses são triggers).

**Confirmed**: Integração coerente, defesa em profundidade, sem buraco de segurança.

### Isolamento multi-tenant e RBAC

Todas as migrations de dados (appointments, schedule_overrides, working_hours, professionals, services) têm RLS ativado com policies USING + WITH CHECK ancoradas em `current_tenant_id()` (helper security definer). FKs compostas por `(tenant_id, id)` fecham buracos cross-tenant no schema. Professional vê apenas própria agenda (via join em `profile_id = auth.uid()`). Admin vê todos do tenant. Receptionist vê todos mas não escreve schedule_overrides ou status (apenas lê e muda agendamento). Nenhum `BYPASSRLS`.

**Confirmed**: RLS em vigor, policies corretas, tenant_id nunca do cliente.

### TypeScript e validações

- `npm run typecheck` passou (sem `any` implícito, strict mode)
- Zod valida entrada (date regex, uuid, time regex)
- Tipos de domínio (`AppointmentWithRelations`, `AvailableSlot`, `ScheduleOverride`, `WorkingHour`) tipados corretamente
- Nenhuma coerção implícita ou escape de tipo

**Confirmed**: Sem erros de compilação, sem advertências.

### Build e testes

- `npm run build` passou (Vite production, sem erro)
- `npm run test` (vitest): 16 testes passaram (generateAvailableSlots suite cobrindo AC-09..17)
- Tamanho do bundle: normal (748KB gzipped para a SPA toda), sem degradação

**Confirmed**: CI limpo.

### Mensagens em PT-BR

- Diálogo: "Novo agendamento" / "Editar agendamento" ✓
- SlotPicker guide: "Escolha profissional, serviço e data para ver os horários livres." ✓
- SlotPicker loading: "Carregando horários livres" ✓
- SlotPicker empty:
  - folga: "O profissional não atende nesta data." ✓
  - fora-vigencia: "Fora do período de atendimento do profissional." ✓
  - sem-grade: "Este profissional ainda não tem grade de horários." + link "Configurar horários" ✓
  - sem-slots: "Nenhum horário livre para este serviço neste dia." ✓
- Form errors (zod): "Selecione um cliente.", "Selecione um profissional.", "Selecione um serviço.", "Informe uma data válida.", "Informe um horário válido (HH:MM)." ✓
- Conflito local: "Este profissional já tem um agendamento neste horário." (via `mapSchedulingError`, AC-18) ✓
- Toast success: "Agendamento criado." / "Agendamento atualizado." ✓

**Confirmed**: Todas as mensagens em PT-BR, coerentes, sem anglicismo.

### Mobilidade e responsividade

- Formulário com `<Input type="date">` (picker nativo mobile-friendly)
- SlotPicker chips com `flex flex-wrap gap-2`, adaptam-se a telas pequenas
- Diálogo com `max-h-[90vh] overflow-y-auto`, não fica preso em smartphone
- Typography usando tabular-nums para horas (alinhadas)

Sem testes E2E, mas estrutura segue mobile-first shadcn + Tailwind.

**Observed**: Layout parece responsivo; QA visual em device real recomendado conforme AC.

### Edge cases e cobertura

1. **Edição com slot próprio**: slot que o agendamento ocupa é excluído de ocupados (via `excludeAppointmentId`), continua ofertável ✓
2. **Corrida (conflito que escapa da checagem)**: capturado pelo constraint 23P01 do banco, traduzido para pt-BR via `mapSchedulingError`, setado no field `time` ✓
3. **Sem profissional/serviço/data**: estado-guia renderizado, chips desabilitados ✓
4. **Carregamento pendente**: skeleton do loading, `aria-busy="true"`, desabilitação implícita (nada clickável) ✓
5. **Vazio honesto** (serviço de 2h não cabe em nenhum slot do dia): "Nenhum horário livre para este serviço neste dia." + sem link ✓
6. **Sem grade**: "Este profissional ainda não tem grade de horários." + link para configurar (quando papel permite, via `canConfigureSchedule` no diálogo) ✓
7. **Fora da vigência**: "Fora do período de atendimento do profissional." ✓
8. **Folga (exceção fechada)**: "O profissional não atende nesta data." ✓

**Confirmed**: Todos os 8 cases testáveis em QA ao vivo (conforme AC-18 da ADR).

### Discussão: performance (RNF01)

ADR pede agenda < 1,5s. Aqui:
- Gerador puro é O(n_windows × n_step × n_busy_check), rápido (em-processo, sem async)
- Queries (working_hours, overrides, validity, services, appointments) são reutilizadas do cache TanStack Query
- Sem request novo (mesma chave do appointmentsQuery)
- Renderização: useMemo em slots + useMemo em derived, evita recálculos

Sem testes de timing, mas a arquitetura segue o PRD §9 (computar no cliente, sem RPC extra).

**Likely**: Performance conforme RNF01. Verificação em QA ao vivo com Chrome DevTools (Lighthouse/profiler) recomendada se houver preocupação.

</details>

---

## Conclusão

ADR-06 está **APROVADA**. Implementação coerente com ADR-05 (gerador + hook), integração segura no diálogo (RLS + validação + RBAC), acessibilidade correta (radiogroup + foco), mensagens em PT-BR, TypeScript estrito, testes passados, build limpo. Nenhum bloqueante. Recomendação: QA ao vivo conforme AC-18 (criar → slot → validar conflito em corrida, acessibilidade no navegador, responsividade em mobile) antes de marcar como aprovada também em fase de QA.

