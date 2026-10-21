# Revisão B — ADR-06: SlotPicker no fluxo de criação (`AppointmentFormDialog`)

Revisor independente B. Escopo revisado: commit `9067952` (`feat: seletor de slots livres no formulário de agendamento (ADR-06)`), diff contra `cba4200`. Dois arquivos: `src/app/agenda/SlotPicker.tsx` (novo) e `src/app/agenda/AppointmentFormDialog.tsx` (editado).

A ADR troca o `<input type="time">` cru por um seletor de chips de horários livres (`SlotPicker`), alimentado pelo `useAvailableSlots` (ADR-05). Término/valor continuam derivados do serviço, o `appointmentSchema` não muda, e a checagem local + constraint do banco permanecem. A mudança é puramente de camada de apresentação `/app` (tenant): não cria superfície nova no banco, não toca `tenant_id`, segredos, webhooks, RLS nem a constraint de não-sobreposição. Aderente à ADR e às fronteiras.

**Watch for:**
- Lógica da cascata de precedência (vigência → exceção → grade) **duplicada** no `emptyReason` do diálogo, separada da fonte canônica em `scheduling-slots.ts`/`useAvailableSlots.ts` — risco de divergência futura da *mensagem* de vazio em relação ao *cálculo* dos slots. *(confirmed, não-bloqueante)*
- `prefill` documentado como "só no (re)abrir", mas entra em `emptyValues` que está nas deps do `useEffect` de reset — uma troca de `prefill` com o diálogo aberto reseta o form. *(confirmed, baixo risco)*

**Verdict**: APPROVED

## High-level view

A substituição do input por chips é coerente com o contrato de ADR-05: o `SlotPicker` é controlado e presentacional (recebe `slots`/`isLoading`/`isEnabled`/`emptyReason`, emite `HH:MM`), e o diálogo liga o `onSelect` ao campo `time` do form via `setValue(..., { shouldValidate })`. O rótulo do slot (`label`, `HH:MM` de `formatTimeInTenantTz`) casa com o regex do `appointmentSchema.time` e com o valor derivado em edição por `toTenantLocal` — seleção, destaque e submit falam a mesma convenção. Contraprova estática limpa (typecheck, build e os 16 testes do gerador de ADR-05).

Fronteiras: nada de novo no banco, nenhum `tenant_id` saindo do cliente, nenhum segredo, nenhum caminho cross-tenant. O RBAC do link "Configurar horários" é só defesa em profundidade (admin vê sempre; professional só para a própria grade; receptionist nunca), com o RLS como trava real — consistente com o PRD §5 e com `usePermissions`. Sem webhook/PIX/WhatsApp, idempotência e LGPD não se aplicam a esta ADR.

O ponto de atenção é de manutenção, não de segurança: o diálogo reimplementa a decisão de "por que não há slots" (vigência/exceção/grade) com cópias locais de `weekdayOf`/`isWithinValidity`, paralelas às de `scheduling-slots.ts`. Hoje concordam; o risco é drift se a precedência do gerador mudar sem o `emptyReason` acompanhar. O design doc React (chips como `radiogroup`, foco visível, indisponível omitido, skeleton com `aria-busy`, copy pt-BR por motivo) está implementado como especificado.

<details>
<summary>Issues (3)</summary>

1. **Cascata duplicada no `emptyReason`** — o diálogo reimplementa vigência→exceção→grade com `weekdayOf`/`isWithinValidity` locais, cópias das de `scheduling-slots.ts`/`useAvailableSlots.ts`. Concordam hoje; para evitar drift, considerar que `useAvailableSlots` exponha o motivo do vazio (ou centralizar os helpers) em vez de recalcular na view. Não-bloqueante.
2. **`prefill` reseta o form com o diálogo aberto** — a doc diz "só tem efeito no (re)abrir", mas `emptyValues` (que depende de `prefill`) está nas deps do `useEffect` de reset; uma mudança de `prefill` enquanto `open` descarta edição em curso. Baixo risco (ADR-08 controla quando `prefill` muda), mas vale alinhar a doc ao comportamento ou gated por `open`.
3. **Chip selecionado comparado por `label`** — `selected = slot.label === value`. Dois slots nunca compartilham `label` (o gerador deduplica por instante de início no mesmo dia), então é correto no escopo de um dia; registrar a premissa caso o picker venha a listar múltiplos dias no futuro.

</details>

<details>
<summary>Details</summary>

### Contrato com ADR-05 e o campo `time`

O diálogo consome `useAvailableSlots({ day, professionalId, serviceId, excludeAppointmentId })` e destructura `{ slots, isLoading: slotsLoading, isEnabled: slotsEnabled }` — bate com o resultado do hook (`UseAvailableSlotsResult`). O `excludeAppointmentId: appointment?.id` garante que, em edição, o horário ocupado pelo próprio agendamento continua ofertável (critério da ADR). O `onSelect` grava `slot.label` (`HH:MM`) no campo `time` com `shouldValidate`, e o regex do `appointmentSchema.time` (`([01]\d|2[0-3]):[0-5]\d`) aceita exatamente esse formato. Em edição, o form popula `time` via `toTenantLocal` zero-padded, no mesmo formato — logo o destaque `selected = slot.label === value` reencontra o slot do próprio agendamento. A convenção `HH:MM` é consistente de ponta a ponta, inclusive na borda de meia-noite (`formatTimeInTenantTz` no ICU deste runtime formata `00:00`, não `24:00`, passando no regex).

### `emptyReason`: cascata reimplementada na view

O diálogo decide a mensagem de vazio (`folga` / `fora-vigencia` / `sem-grade` / `sem-slots`) replicando a cascata de precedência do gerador, com `weekdayOf` e `isWithinValidity` locais — cópias textuais das que vivem em `scheduling-slots.ts` (e em `useAvailableSlots.ts`, no caso de `weekdayOf`). A ordem está correta e espelha a canônica: vigência primeiro, exceção depois (fechado → `folga`; janela atípica sem horário útil → `sem-slots`), grade por fim (`sem-grade` quando não há faixa no weekday). Enquanto as duas implementações concordarem, a UX é exata.

O risco é de manutenção: se a precedência do gerador evoluir (ex.: feriado de tenant numa fase futura, ou mudança na união de faixas), a mensagem pode divergir do que o gerador realmente fez, mostrando "sem grade" quando o motivo verdadeiro é outro. A alternativa de menor acoplamento é `useAvailableSlots` devolver, junto com `slots`, o motivo do vazio já derivado da mesma cascata — a view consome, não recalcula. Fica como melhoria, não bloqueio: o escopo desta ADR é o SlotPicker, e a duplicação não cruza nenhuma fronteira de segurança.

### Releitura de insumos sem request novo

O diálogo chama `useWorkingHours`/`useScheduleOverrides`/`useScheduleValidity` com `activeProfessionalId` só para montar o `emptyReason`. Como `useAvailableSlots` já lê as mesmas chaves, o TanStack Query deduplica por `queryKey` e nenhum request extra é aberto — coerente com a intenção de ADR-05 (RNF01, sem waterfall). Os três hooks aceitam `string | null` com `enabled: !!professionalId`, então passar `null` (sem profissional escolhido) é seguro.

### Acessibilidade e estados (design doc React)

`SlotPicker` implementa o que a análise frontend pediu: grupo `role="radiogroup"` + `aria-label="Horários livres"`, chips como `role="radio"` com `aria-checked`, foco visível (`focus-visible:ring-2`), `Enter`/`Espaço` nativos do `<button type="button">`, slot indisponível **omitido** (não renderizado desabilitado), skeleton de 8 chips com `aria-busy` no carregamento, e estado-guia textual quando faltam profissional/serviço/dia. A copy pt-BR por motivo de vazio está no mapa `EMPTY_MESSAGE` conforme ADR, e o link "Configurar horários" só aparece no caso `sem-grade` quando o papel permite. `tabular-nums` nos chips mantém alinhamento dos horários.

### RBAC do link de configuração (defesa em profundidade)

`canConfigureSchedule = canEditAnySchedule || (canEditOwnSchedule && activeProfessionalId === lockedProfessionalId)`. Para admin, `canEditAnySchedule` é `true` → link sempre disponível. Para professional, `lockedProfessionalId` é o próprio id → só aparece para a própria grade. Para receptionist, ambos `false` → sem link. Bate com o mapa de papéis do PRD §5. É apenas UI; a trava de escrita da grade segue no RLS/`working_hours` (não tocado aqui). Nenhum dado financeiro é exposto na tela.

### `prefill` e o ciclo de reset

`prefill` alimenta `emptyValues` (profissional/início pré-preenchidos para o caminho "faixa vazia" de ADR-08) e é ignorado em edição (o branch `appointment` do `useEffect` reseta para os valores do agendamento). O comentário diz "Só tem efeito no (re)abrir", mas `emptyValues` depende de `prefill` e está nas deps do `useEffect`, então uma troca de `prefill` com o diálogo já aberto dispararia `form.reset(emptyValues)` e descartaria o que o usuário tivesse digitado. Na prática ADR-08 só muda `prefill` ao (re)abrir, então o risco é baixo; ainda assim, alinhar a doc ao comportamento real (ou condicionar o reset a uma transição de `open`) evita surpresa quando o caminho de faixa vazia for integrado.

### Contraprova (estática)

- `npm run typecheck` (`tsc -b`) — limpo (exit 0).
- `npm run build` (`tsc -b && vite build`) — limpo (exit 0); aviso pré-existente de chunk > 500 kB, não introduzido por esta ADR.
- `npm run test` (`vitest run`) — 16/16 passam (`scheduling-slots.test.ts`, do ADR-05, dependência desta ADR).

Verificação visual ao vivo (chips renderizando grade/exceção/vigência, criação a partir de chip, corrida 23P01 com mensagem pt-BR, fuso, mobile 360px) é decisão do QA no step seguinte, conforme instruído — não subi dev server aqui.

</details>

<details>
<summary>Arquivos no escopo</summary>

- `src/app/agenda/SlotPicker.tsx` (novo) — componente controlado/presentacional de chips; `radiogroup`, estados vazio/loading/guia, copy pt-BR, link condicional de configuração.
- `src/app/agenda/AppointmentFormDialog.tsx` (editado) — troca `<input type="time">` por `SlotPicker`; liga `useAvailableSlots`; deriva `emptyReason` (cascata reimplementada); prop `prefill` para ADR-08; mantém `hasLocalConflict`, submit, `mapSchedulingError` e derivados read-only.

Diff completo: `git show 9067952`.

</details>
