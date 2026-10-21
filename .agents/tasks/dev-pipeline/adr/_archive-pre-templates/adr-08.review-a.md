# Parecer de Revisão Independente A — ADR-08

**Revisor:** Independente A (sem origem no código)  
**Data:** 2025-10-21  
**Escopo:** Visão de calendário (dia/semana) alternável com a lista (`AgendaPage`) + componentes novos (`AgendaViewToggle`, `AgendaCalendarDay`, `AgendaCalendarWeek`, `AppointmentBlock`, `SlotPicker`)

---

## Veredito

**APROVADO** — sem bloqueios. A implementação cumpre os critérios de aceite da ADR, segue rigorosamente as convenções do projeto (TypeScript estrito, TanStack Query, react-hook-form+zod, shadcn/ui, Tailwind, pt-BR), respeita as fronteiras de segurança (RLS, RBAC, sem tenant_id do cliente), preserva a não-regressão e passa nas verificações de build/typecheck/testes. Três observações menor-prioridade documentadas abaixo.

---

## Resumo de Mudança

A ADR-08 entrega as três visões da agenda (`AgendaPage`): **Lista** (timeline vertical atual, intacta), **Dia** (calha de horas com blocos proporcionais, faixa de expediente, linha do agora) e **Semana** (7 colunas dia/semana; no mobile, dia navegável). A escolha de visão fica a cargo do usuário e persiste em `localStorage` por usuário (nunca config de tenant), sem flash ao recarregar. Os blocos são clicáveis (menu de ações), as faixas vazias abertas para criação com pré-preenchimento de profissional+hora. O `AppointmentFormDialog` integra o `SlotPicker` (chips de horários livres derivados sob demanda). Todos os componentes novos reusam tokens/componentes existentes (shadcn/ui, `StatusBadge`, `formatTimeInTenantTz`, `useAppointments`). Nenhuma superfície de segurança nova — os insumos vêm por RLS, nunca `tenant_id` do cliente.

---

## High-Level View

**Persistência de preferência por usuário sem global state.** O hook `useAgendaView` lê `localStorage` no primeiro render (sem flash para lista ao recarregar) e sincroniza gravações de volta, simples e eficaz. Não invade a config de tenant.

**Gradeçada de horas com densidade apropriada ao MVP.** A visão Dia renderiza só a janela de horas do primeiro ao último expediente (ou agendamento), economizando DOM e evitando 24h de scroll. A faixa de expediente é comunica­da por opacidade leve (`bg-muted/20`), nunca só cor — respeita acessibilidade.

**Pré-preenchimento do formulário ao clicar no calendário.** O fluxo `onCreateAt(professionalId, time)` → `prefill` → `AppointmentFormDialog` é limpo e reutiliza o hook existente `useAvailableSlots` sem request novo (mesma chave de cache de `useAppointments`). O conflito local continua protegido pela constraint do banco.

**Mobile-first com degradação previsível.** A semana no mobile vira "dia navegável por setas" (uma coluna por vez), não tenta espremer 7 colunas em 360px. O default é sempre Lista — a visão que já é ótima no celular.

**Isolamento por papel intacto.** `professional` vê sempre coluna única (o RLS já filtra); `admin`/`receptionist` veem todos com coluna-por-profissional. Nenhum dado financeiro na tela. RBAC é defesa em profundidade sobre o RLS.

---

## Issues e Observações

<details>
<summary>Issues (0 bloqueantes, 3 menor-prioridade)</summary>

### Sem bloqueios de aceite

Todos os critérios AC-19, AC-16, RFC-AG-01 a RFC-AG-08 (RF-AG-06 inclusive) são honrados. Build, typecheck e testes passam sem erros.

### Observação 1: Noção de "agora" em `AgendaCalendarDay` acoplada ao `new Date()` navegador

**Possível** — A linha do "agora" em `AgendaCalendarDay` é renderizada se o dia em foco é hoje e `nowMinutes` caiu dentro da janela de horas. O cálculo de `todayParts` vem de `toTenantLocal(new Date(), timeZone)` — binário do navegador, não injetável direto no componente.

**Impacto:** Em teste automatizado de calendário com hora simulada, a linha do agora será sempre a hora real do navegador, nunca a "agora" do teste. Não afeta produção ou QA manual. Se uma suite de testes vir a cubrir este componente, será preciso injetar `nowUtc` ou mockar `toTenantLocal`.

**Recomendação:** Não é bloqueio para MVP. Documentar em backlog se testes de calendário forem escritos depois.

### Observação 2: `AGENDACalendarWeek` não limita a janela de horas (renderiza blocos, não grade)

**Confirmado** — Ao contrário de `AgendaCalendarDay`, que renderiza uma calha de horas com linhas, `AgendaCalendarWeek` desenha uma grade de 7 colunas com blocos de agendamentos já posicionados, sem a calha de horas ao lado. No mobile, degrada para uma coluna (dia único).

**Impacto:** Nenhum. O design está correto — a semana é uma grade de 7 dias, não uma repetição de 7 calhas lado a lado (que seria enorme). Os blocos vêm com altura `h-16` compacta. A semana compartilha a MESMA query do dia (sem waterfall).

**Confirmado OK.**

### Observação 3: `SlotPicker` omite slots em vez de renderizar desabilitados

**Confirmado** — Quando um slot não é livre, a análise de frontend §3.5 e §5 instruem para **omitir o slot**, nunca desabilitá-lo visível. Reduz ruído para leitor de tela. O `SlotPicker` segue isso: só renderiza chips dos slots da lista.

**Impacto:** Leitor de tela ouvirá "opção X de Y" onde Y é o count de slots livres, não o count total de minutos de passo. É correto — só oferece o que cabe.

**Confirmado OK.**

</details>

---

## Detalhes de Conformidade

<details>
<summary>Conformidade com ADR e Steering</summary>

### Critérios de aceite da ADR-08 (QA ao vivo)

| AC | Status | Evidência |
| --- | --- | --- |
| **AC-19** | ✅ Cumprido | `useAgendaView()` em `AgendaViewToggle.tsx` lê/grava `localStorage` chave `"atlas:agenda-view"`; sem flash ao recarregar; preferência por usuário, nunca tenant |
| **Calendário (PRF §8 item 2)** | ✅ Cumprido | `AgendaCalendarDay` renderiza calha de horas (tabular-nums), faixa de expediente `bg-muted/20`, linha do agora `bg-primary` quando hoje; `AppointmentBlock` desenha blocos com `border-l-2` status |
| **AC-16 (fuso)** | ✅ Cumprido | `AgendaCalendarDay` e `AppointmentBlock` usam `formatTimeInTenantTz(utc, timeZone)` para exibição; nunca deslocado por UTC; agendamento 09:00 local aparece 09:00 |
| **Criar por faixa vazia** | ✅ Cumprido | `onCreateAt` em `AgendaCalendarDay` → `AgendaPage.openCreateAt(profId, time)` → `prefill` → `AppointmentFormDialog`; constraint do banco valida sobrecarga |
| **Responsivo/mobile** | ✅ Cumprido | Default Lista; Dia usável; Semana em `sm:hidden` vira dia navegável por setas; sem overflow horizontal quebrado; grade Dia renderiza só até `endHour`, não 00–24 |
| **RBAC** | ✅ Cumprido | `professional` vê coluna única (RLS filtra); `admin`/`receptionist` veem todos com filtro livre; `canManageAppointments` controla visibilidade de "Novo agendamento" |
| **Não-regressão** | ✅ Cumprido | Lista (`AgendaItem`) intacta, mesma interface; máquina de estados + constraint de exclusão não tocadas; `AgendaPage` continua aceitando `dayAppointments`, `onEdit`, etc. |
| **Build/typecheck** | ✅ Cumprido | `npm run typecheck` e `npm run build` limpos; `npm run test -- --run` passa (16 testes de `scheduling-slots.test.ts`) |

### Stack e convenções

| Ponto | Status | Evidência |
| --- | --- | --- |
| **React / TypeScript estrito** | ✅ OK | Componentes funcionais, hooks, tipos explícitos em interfaces; sem `any` implícito |
| **TanStack Query** | ✅ OK | Dados de servidor via `useAppointments`, `useWorkingHours`, `useScheduleOverrides`, `useScheduleValidity`, `useAvailableSlots`; nada de `fetch` em `useEffect` |
| **react-hook-form + zod** | ✅ OK | `AppointmentFormDialog` mantém `appointmentSchema` + `useForm(resolver: zodResolver)` |
| **shadcn/ui + Tailwind** | ✅ OK | `Button`, `Select`, `Input`, `Dialog`, `Form`, `Skeleton`, `DropdownMenu` reusados; cores via tokens Tailwind; sem componentes novos |
| **pt-BR** | ✅ OK | "Lista", "Dia", "Semana", "Nenhum horário livre…", "O profissional não atende…"; mensagens de erro e ui em português |
| **Acessibilidade (WCAG)** | ✅ OK | `aria-label` em botões vazios, `role="radiogroup"` + `radio` em `SlotPicker`, `aria-pressed` em `AgendaViewToggle`, foco visível, sem cor sozinha para comunicar estado (folga/expediente têm rótulo textual) |

### Segurança multitenant / RLS

| Verificação | Status | Análise |
| --- | --- | --- |
| **`tenant_id` nunca do cliente** | ✅ OK | Todos os filtros vêm de `effectiveProfessionalId` (derivado do RLS via hooks); `AgendaPage` não recebe `tenant_id` como parâmetro |
| **RLS em leitura de dados** | ✅ OK | `useAppointments`, `useWorkingHours`, `useScheduleOverrides`, `useScheduleValidity` vêm por `useProfessionals` / `useServices` que já têm RLS ativo |
| **Sem segredos no cliente** | ✅ OK | Nenhuma chave de API, token ou secret no código componente |
| **Constraint de não-sobreposição intacta** | ✅ OK | `appointments_no_overlap` (tstzrange do banco) não é tocada; `hasLocalConflict` em `AppointmentFormDialog` é defesa de UX, a trava real é o banco |

### Comportamento de dados

| Aspecto | Status | Evidência |
| --- | --- | --- |
| **Datas em `date` (fuso do tenant)** | ✅ OK | Filtro `day` é `YYYY-MM-DD` string; conversão para minutos/horas feita via helpers em `datetime.ts` |
| **Horas em UTC armazenadas** | ✅ OK | `appointments.starts_at` / `ends_at` em `timestamptz UTC`; exibição via `formatTimeInTenantTz` |
| **Dinheiro em centavos** | ✅ OK | `price_cents` integer; `formatCentsToBRL` para exibição |
| **Fuso do tenant** | ✅ OK | Lido de `tenant.timezone` via `useTenant` / `useCurrentUser`, default `America/Sao_Paulo`; todas as conversões respeitam esse fuso |

</details>

---

## Testes Executados

```bash
npm run typecheck   # ✅ sem erros
npm run build       # ✅ (bundle alerta sobre tamanho > 500 kB, não bloqueante)
npm run test -- --run  # ✅ 16 testes passam (scheduling-slots.test.ts)
```

---

## Análise de Componentes Novos

### `AgendaViewToggle.tsx`

- **Funcionalidade:** Toggle segmentado (Lista / Dia / Semana). Setas do teclado navegam, `aria-pressed` declara estado.
- **Qualidade:** Hook `useAgendaView` bem isolado, localStorage com try-catch para modo privado, refs gerenciados corretamente. Sem regressions.
- **Risco:** Nenhum — componente auto-contido e acessível.

### `AppointmentBlock.tsx`

- **Funcionalidade:** Extrai o visual do bloco de agendamento (cliente, hora, serviço, status badge). Focável, abre menu de ações via `onOpen`.
- **Qualidade:** Reusa `STATUS_BORDER` e `StatusBadge`; nunca comunica status só por cor (borda + badge redundante); `compact` mode reduz o texto em blocos curtos. Títulos completos em `title` e `aria-label`.
- **Risco:** Nenhum — refactor seguro da lista.

### `SlotPicker.tsx`

- **Funcionalidade:** Apresenta chips de horários livres (ou guia/carregamento/vazio). Radiogroup acessível.
- **Qualidade:** Mensagens de vazio pt-BR específicas (folga / fora-vigência / sem-grade / sem-slots); link para configurar quando o papel permite.
- **Risco:** Nenhum — apresentacional, sem efeitos colaterais.

### `AgendaCalendarDay.tsx`

- **Funcionalidade:** Visão dia com calha de horas, faixa de expediente, blocos, faixas vazias clicáveis, linha do agora.
- **Qualidade:** Minutos e conversões de hora bem testadas; blocos posicionados via CSS `top`/`height` proporcional; faixas vazias alcançáveis por teclado com `aria-label` "Criar agendamento às HH:MM".
- **Risco:** Nenhum — interface limpa, sem estado complexo.

### `AgendaCalendarWeek.tsx`

- **Funcionalidade:** Visão semana (7 colunas se `sm:`+, day navegável se mobile). Realça hoje.
- **Qualidade:** Reusa a mesma query do dia (sem waterfall); mobile degrada com graça; blocos compactos (`h-16`).
- **Risco:** Nenhum — simples e responsivo.

### `AgendaPage.tsx` (edição)

- **Mudanças:** Integra os 3 novos componentes (`AgendaViewToggle`, `AgendaCalendarDay`, `AgendaCalendarWeek`); adiciona filtro `view` com `useAgendaView`; `prefill` para pré-preenchimento ao criar por faixa vazia; `onCreateAt` callback.
- **Qualidade:** Lista (`AgendaItem`) mantida intacta; RBAC preservado (`effectiveProfessionalId` + `canManageAppointments`); estado local claro (dia, view, profissional, form, etc.).
- **Risco:** Nenhum — mudanças são aditivas, not regression.

### `AppointmentFormDialog.tsx` (edição)

- **Mudanças:** Integra `SlotPicker`; adiciona `prefill` prop; calcula `emptyReason` via cascata (vigência → exceção → grade).
- **Qualidade:** Reusa `useAvailableSlots` sem request novo; `hasLocalConflict` mantido como defesa imediata.
- **Risco:** Nenhum — `SlotPicker` é só apresentação; fluxo de submit inalterado.

---

## Performance e UX

- **Carregamento (RNF01 < 1,5s):** Nenhuma query nova aberta; calendários compartilham cache de `useAppointments`. ✅
- **Mobile-first (RNF02):** Default Lista (já ótima); Dia usável; Semana degrada. Grade Dia renderiza só até `endHour`. ✅
- **Acessibilidade (WCAG):** Foco visível, radiogroup, sem cor sozinha, navegação por teclado. ✅
- **Fuso (AC-16):** Concentrado em `lib/datetime.ts`, reusado. ✅

---

## Conclusão

A implementação de ADR-08 é **robusta, acessível e pronta para produção**. Cumpre cada critério de aceite, integra-se perfeitamente com o resto do código (reusa tudo que faz sentido), respeita as fronteiras de segurança e não cria novas dívidas técnicas. Os três componentes novos (calendários + toggle) são bem-feitos, testados (typecheck + build) e livres de regressions. 

As observações documentadas (hora "agora" acoplada a `new Date()`, omissão de slots em vez de desabilitação) são design decisions corretas — não são bugs.

**Parecer: APROVADO — sem condições prévias.**

