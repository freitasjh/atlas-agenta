# Análise de Frontend — Evolução da Agenda: slots sob demanda, exceções/vigência e visão de calendário

Projeto: **atlas-agenda** · Pipeline: dev-pipeline · Papel: **Designer dedicado de frontend**
Workdir: `/home/joao/fusionlf/wsProjeto/atlas-agenda`
Tipo de rota: **Feature (pesada)** · Área: `/app` (tenant)

> Esta demanda **toca tela** — e muito. Há três frentes de UI novas (geração/seleção de slots no
> fluxo de criação, visão de calendário alternável com a lista, e edição de exceções + vigência da
> grade por profissional). Produzo o design completo. A tensão de modelagem de slots (passo fixo
> vs. duração do serviço) é resolvida e justificada na §1 — é a decisão front-loaded que a tarefa
> pediu. Não escrevo código de aplicação aqui.
>
> Fonte da verdade: `.kiro/steering/` (produto, domínio, stack, segurança-multitenant,
> convenções) + skills `ui-frontend` e `frontend-design`. Código existente lido:
> `AgendaPage.tsx`, `AppointmentFormDialog.tsx`, `useAppointments.ts`, `useWorkingHours.ts`,
> `WeekScheduleForm.tsx`/`DayRow.tsx`/`HorariosPage.tsx`, `lib/datetime.ts`, `usePermissions.ts`,
> `StatusBadge.tsx`, `index.css`, `tailwind.config.ts`, migrations de catálogo e appointments.

---

## 0. Veredito de superfície de frontend

A feature **toca tela** em três lugares, todos dentro de `/app` (tenant, nunca `/admin`):

1. **`/app/agenda` (AgendaPage)** — ganha (a) alternância **calendário ↔ lista** controlada pelo
   usuário (não config de tenant) e (b) um fluxo de **criação a partir de um slot livre**.
2. **Fluxo de criação de agendamento (AppointmentFormDialog)** — ganha um **seletor de horário por
   slots livres gerados sob demanda** (grade − exceções − vigência − ocupados, consumindo a
   duração do serviço), substituindo/complementando o `<input type="time">` cru atual.
3. **Grade do profissional (`/app/config/profissionais/:id/horarios`, HorariosPage)** — ganha
   **duas seções novas** além da grade semanal que já existe (reusada, não recriada): **vigência**
   (período início/fim em que o profissional atende) e **exceções por data** (folga/feriado/horário
   atípico).

**Reuso explícito (não reescrever):** a grade semanal (`WeekScheduleForm`/`DayRow`/
`useWorkingHours`), o `AppointmentFormDialog` como diálogo-base de criação, os helpers de fuso de
`lib/datetime.ts`, os tokens de status e o `StatusBadge`, o `usePermissions`, o `PageHeader` e o
`StatePanel` (padrão de estado vazio/erro já replicado nas telas de `/app`).

**Dependências de dados sinalizadas ao planejamento (back-end/dados, fora do meu papel):**

- **D1 — Entidade nova `schedule_overrides`** (exceções por data) multi-tenant com RLS, FK composta
  por tenant ao profissional, mesmo RBAC da grade. **Não existe ainda.**
- **D2 — Vigência da grade por profissional** (`valid_from`/`valid_until`): decisão de dados sobre
  onde mora (coluna em `professionals`, ou tabela de vigência, ou campos na própria grade). **Não
  existe ainda.** O front consome como um par de datas por profissional.
- **D3 — Geração de slots sob demanda**: função determinística que combina grade semanal + exceções
  + vigência + agendamentos ocupados + duração do serviço, no fuso do tenant, **sem materializar**.
  O front precisa dela como fonte dos slots; a análise de dados decide se roda no cliente (TS puro
  sobre dados já lidos por RLS) ou numa RPC/Edge Function. **Recomendação do front na §4.3.**
- **D4 — "Tempo-base de atendimento" próprio do profissional** (passo da grade de slots): se existir
  como dado persistido, é coluna nova em `professionals`. **Recomendação do front na §1** — pode
  nascer como constante de UI sem schema novo.

Nenhuma rota de `/admin`, nenhuma tela de marketing/auth é tocada. Dark mode é padrão do app
(ThemeProvider) e vale para tudo que eu desenhar.

---

## 1. Decisão front-loaded: como os slots são gerados e oferecidos

> Este é o ponto que a tarefa mandou resolver **antes** de codar. Recomendo e justifico; não chuto.

### 1.1 A tensão

- **(A) Grade de slots com passo fixo** (ex.: de 30 em 30 min): a disponibilidade vira uma grade
  regular de horários candidatos; o agendamento ocupa N passos conforme a duração.
- **(B) Slot = duração do serviço**: os horários candidatos são gerados diretamente pela duração do
  serviço escolhido, encostando um no próximo (ex.: serviço de 1h gera 09:00, 10:00, 11:00…).

### 1.2 Decisão: **híbrido com passo-base configurável, ancorado na grade — recomendo passo-base de 30 min como default, e o serviço consome o bloco correspondente**

A leitura mais fiel ao exemplo do usuário (clínica; serviço de 1h **ou** 2h) é: **a disponibilidade
é a grade do profissional; o encaixe de um agendamento consome o tempo da duração do serviço
escolhido, a partir de um horário de início válido dentro da grade, descontando ocupados e
exceções.** Isso é a diretriz da própria tarefa, e descarta (B) puro — gerar candidatos só de hora
em hora para um serviço de 1h impediria um corte das 09:30 quando o expediente começa 09:00 e o
slot anterior vai até 10:00; perde-se granularidade real de encaixe.

Também descarto (A) "puro e cego", em que cada passo é um slot independente oferecido sem relação
com a duração: isso empurra para o usuário a conta de "cabe ou não cabe" o serviço de 2h.

**O híbrido que recomendo:**

- Existe um **passo-base** (granularidade de início dos cortes). Default **30 min**.
- Os **horários de início candidatos** são gerados varrendo cada janela da grade do dia (descontando
  o intervalo/almoço e as exceções) em incrementos do passo-base.
- Um horário de início só vira **slot ofertável** se o bloco `[início, início + duração_do_serviço)`
  **couber inteiro** dentro da janela de atendimento (não cruza o fim do expediente nem o intervalo)
  **e não sobrepuser** nenhum agendamento ativo do profissional. Assim um serviço de 1h e um de 2h
  partem da **mesma** grade de inícios de 30 em 30, mas o de 2h oferta menos opções porque precisa de
  um bloco maior livre. É exatamente "1h/2h consomem os slots do profissional".
- **Não** materializa slots (constraint da tarefa): a lista de slots é **derivada sob demanda** a
  cada combinação (profissional, dia, serviço), recomputada quando qualquer insumo muda.

### 1.3 "Tempo-base de atendimento próprio do profissional" (D4)

O usuário disse: "Cada profissional vai ter o seu tempo de consulta, mas vamos ver o caso de uma
clínica, tem serviço que pode demorar uma hora ou duas, aí vai pegar os horários dos slots do
profissional." Leitura: o **passo-base** é a materialização desse "tempo de consulta" do
profissional. Recomendação faseada para o planejamento:

- **Fase desta entrega:** o passo-base é uma **constante de UI** (30 min), **sem schema novo** —
  entrega a feature inteira sem bloquear em D4. Documentar a constante num único lugar
  (`lib/scheduling-slots.ts`, p.ex.).
- **Evolução natural (backlog, se o planejamento quiser incluir já):** `professionals.slot_minutes`
  (coluna nova, default 30) para o profissional calibrar a própria granularidade. O front já desenha
  o seletor preparado para receber esse valor por profissional; se a coluna não vier agora, usa o
  default. **Não** inventar tela de configuração desse campo nesta entrega se a coluna não existir.

Justificativa de não chutar schema: criar coluna é decisão de dados (análise de dados + migration).
O front não depende dela para funcionar — depende só de **um** número de passo por profissional, que
tem default seguro.

### 1.4 Por que isto não é o default genérico

Um designer de IA "no automático" entregaria (B) puro (lista de horas cheias) ou um date-time picker
nativo. O híbrido ancorado na grade é a escolha específica desta clínica: respeita janela, intervalo,
exceção, vigência e a duração variável do serviço, e mantém a não-sobreposição visível **antes** do
submit — o slot ocupado simplesmente não aparece.

---

## 2. Telas, componentes, rotas e guards

### 2.1 Mapa de rotas (nenhuma rota nova de nível; só enriquecimento)

| Rota | Mudança | Guard |
| --- | --- | --- |
| `/app/agenda` | Toggle calendário↔lista + criação por slot | auth + `canManageAppointments` p/ criar; leitura p/ todos os papéis do tenant |
| `/app/config/profissionais/:id/horarios` | +Vigência +Exceções (abaixo da grade semanal) | auth + mesma regra de edição da grade (admin qualquer; professional só a própria; receptionist leitura) |

Guards herdados, **não recriados**: `RequireAuth` (sessão Supabase → senão `/login`), o guard de
**status de assinatura** do `AppLayout`/`/app` (`bloqueado` → tela de **quitação** `/app/quitacao`;
`cancelado` → suspenso) e o RBAC via `usePermissions`. Nada do que eu desenho fura esses guards: a
nova UI de agenda e de horários vive **dentro** do `/app` já protegido. Reafirmo: **o RLS é a trava
real**; a UI só esconde/desabilita o que o papel não pode — defesa em profundidade.

### 2.2 Componentes novos (e onde moram)

**Agenda (`src/app/agenda/`):**

- `AgendaViewToggle.tsx` — alternador segmentado **Lista / Dia / Semana**. Controla só estado local
  do usuário; persiste a preferência em `localStorage` por usuário (não é config de tenant). Teclado:
  setas entre opções, `aria-pressed`.
- `AgendaCalendarDay.tsx` — visão **dia**: eixo vertical de horas (coluna de rótulos à esquerda,
  tabular-nums), uma ou mais **colunas por profissional** (quando admin/recepção veem "todos"),
  blocos de agendamento posicionados por `starts_at`/`ends_at` com altura proporcional à duração,
  borda-lateral + `StatusBadge` por status (reusa `STATUS_BORDER` e o mapa de cores já existente).
  Clicar numa faixa vazia abre o diálogo de criação já com profissional+início pré-preenchidos.
- `AgendaCalendarWeek.tsx` — visão **semana**: 7 colunas de dia (segunda→domingo, mesma ordem de
  exibição que a grade usa em `DISPLAY_ORDER`), cada coluna é uma pista de agendamentos do
  profissional filtrado. No mobile, degrada para **uma coluna de dia navegável** (a semana completa
  lado a lado não cabe em 360px — ver §3.5).
- `AppointmentBlock.tsx` — o bloco visual de um agendamento dentro do calendário (extrai a parte
  visual que hoje vive inline no `AgendaItem`; o `AgendaItem` da lista permanece).
- `SlotPicker.tsx` — grade de **chips de horário livre** usada dentro do `AppointmentFormDialog`
  (seção 2.3). Recebe os slots já calculados e emite o início escolhido.

**Horários (`src/app/config/profissionais/horarios/`):**

- `ScheduleValidityForm.tsx` — vigência: dois `<input type="date">` (início / fim opcional) +
  switch "sem data de término". Validação zod (fim ≥ início; ambos no fuso do tenant como data pura).
- `ScheduleOverridesSection.tsx` — lista de exceções por data do profissional + botão "Adicionar
  exceção".
- `OverrideFormDialog.tsx` — diálogo de criar/editar uma exceção: data, **tipo** (`folga` /
  `horario_atipico`), e — quando `horario_atipico` — janela(s) de atendimento daquele dia específico
  (início/fim, intervalo opcional), reusando a mesma ergonomia de `DayRow`.
- `OverrideItem.tsx` — item da lista de exceções com badge de tipo e ações editar/remover.

### 2.3 Fluxo de criação por slot (AppointmentFormDialog, reusado e estendido)

O diálogo atual já faz a ordem certa (cliente → profissional → serviço → data → hora, com término e
valor derivados read-only). A mudança é **trocar o `<input type="time">` cru por `SlotPicker`**,
mantendo todo o resto:

1. Enquanto **profissional + serviço + data** não estão escolhidos, o `SlotPicker` mostra um estado
   guia ("Escolha profissional, serviço e data para ver os horários livres.").
2. Com os três definidos, dispara a query de slots (TanStack Query, §4) e renderiza **chips** de
   horário livre. A duração do serviço já filtra o que cabe (§1.2).
3. Selecionar um chip preenche o `time` do form; término e valor derivados continuam aparecendo
   exatamente como hoje.
4. **Dois caminhos de entrada no diálogo:** (a) botão "Novo agendamento" (fluxo atual); (b) clique
   numa faixa/slot vazio do calendário, que **pré-preenche** profissional + data + início e abre o
   diálogo já no serviço. Ambos convergem no mesmo submit e na mesma checagem de conflito local +
   constraint do banco.
5. **Edição:** ao editar um agendamento existente, o slot atual dele continua ofertável mesmo
   "ocupado" (ele é o próprio ocupante) — o `SlotPicker` recebe o `appointmentId` em edição para
   excluí-lo do desconto de ocupados, espelhando o que `hasLocalConflict` já faz.

A checagem de conflito local (`hasLocalConflict`) **permanece** como feedback imediato; a constraint
`tstzrange` do banco (`23P01` → `mapSchedulingError`) continua sendo a trava real. Os slots reduzem a
chance de erro, mas **não substituem** a trava — corrida entre dois operadores ainda cai na
constraint com a mesma mensagem pt-BR.

### 2.4 RBAC nas telas novas (defesa em profundidade sobre o RLS)

- **admin**: calendário/lista de todos os profissionais; edita vigência e exceções de qualquer
  profissional; cria agendamento para qualquer um.
- **professional**: calendário/lista só da própria agenda (o filtro de profissional some, como já é
  hoje); edita a própria vigência/exceções; a de outro profissional abre em **leitura** (mesma regra
  de `HorariosPage`). Slots só do próprio.
- **receptionist**: calendário/lista de todos; cria agendamento para qualquer um; **vigência e
  exceções em leitura** (recepção não escreve catálogo/grade — espelha o RLS de `working_hours`, que
  não dá escrita à recepção). Sem qualquer dado financeiro na agenda (não há `charges` nesta tela).

---

## 3. Direção visual e design system

### 3.1 Ancoragem

O app já tem uma identidade definida e madura: **"painel de operação calmo"** — ardósia/azul-noite
com acento **jade** (`--primary: 160 64% 45%` no dark), tipografia **Space Grotesk** (display) +
**Inter** (corpo) + **JetBrains Mono** (dados), raio 0.75rem, tabular-nums ligado no corpo. **Não
invento um sistema novo** — a feature de calendário precisa se dissolver nesse painel, não competir
com ele. O risco estético que assumo é **a própria grade de calendário**: uma superfície densa de
tempo que, bem-feita, é o elemento memorável desta entrega — e que eu mantenho quieta em cor,
deixando o **status** ser a única fonte de cor saturada (reuso dos tokens `--status-*`).

### 3.2 Tokens — tudo reusa o que existe; adiciono só o necessário

| Uso | Token/classe | Observação |
| --- | --- | --- |
| Fundo da grade de calendário | `bg-card` / `bg-background` | linhas de hora em `border-border` |
| Linha de hora / meia-hora | `border-border` (cheia) e `border-border/50` (meia) | hairline, sem peso |
| **Linha do "agora"** | `bg-primary` (2px) + bolinha | único uso de acento jade na grade — o "você está aqui" |
| Bloco de agendamento | `bg-card` + `border-l-2 border-status-*` | reusa `STATUS_BORDER` e `StatusBadge` |
| Faixa fora da grade (sem expediente) | `bg-muted/30` hachurada leve | comunica "aqui não atende" sem texto |
| Exceção de **folga** no calendário | overlay `bg-muted/40` + rótulo "Folga" | lê como bloqueio, não como vazio |
| Chip de slot livre (SlotPicker) | `Button variant="outline"` + estado selecionado `bg-primary text-primary-foreground` | reusa o Button shadcn |
| Toggle de visão | padrão "segmented" com `bg-secondary` e item ativo `bg-background shadow-sm` | mesmo peso dos controles atuais |

**Não** crio tokens de cor novos. Se o planejamento quiser um token para "faixa sem expediente" e
"folga", recomendo derivar de `--muted` por opacidade (como acima) em vez de nova variável — mantém
o tema dark/light coerente de graça.

### 3.3 Tipografia na grade

- Rótulos de hora: `font-mono`/tabular-nums, `text-xs`, `text-muted-foreground` — alinhados à
  direita na calha de horas.
- Nome do cliente no bloco: `font-medium text-foreground text-sm`; serviço/profissional
  `text-xs text-muted-foreground`. Em blocos curtos (< 30 min de altura), **só** cliente + horário,
  com o resto em `title`/tooltip para não espremer.
- Cabeçalho de dia na visão semana: `font-display` (Space Grotesk), dia da semana por extenso curto
  (“seg”, “ter”) + número, com o **hoje** destacado por `text-primary` e peso.

### 3.4 Estados visuais (todos obrigatórios, no molde das telas atuais)

- **Carregando**: `Skeleton` — na grade, esqueleto da calha de horas + blocos fantasmas; nos chips de
  slot, 6–8 chips esqueleto. `aria-busy="true"`.
- **Vazio (sem agendamentos)**: na lista, o `StatePanel` já existente; no calendário, a grade aparece
  **vazia mas desenhada** (as horas e as faixas de expediente visíveis) — o vazio de calendário é a
  própria grade limpa, não um painel central (um calendário sem malha confunde).
- **Vazio (sem slots livres)**: no `SlotPicker`, mensagem direta: "Nenhum horário livre para este
  serviço neste dia." + dica contextual ("Tente outro dia ou um serviço mais curto."). Se a causa for
  **folga/fora de vigência**, a mensagem é específica: "O profissional não atende nesta data
  (folga/feriado)." / "Fora do período de atendimento do profissional."
- **Erro**: `StatePanel` com "Tentar novamente" (reusa o padrão de `refetch`).
- **Sem grade configurada**: se o profissional não tem `working_hours`, o `SlotPicker` diz "Este
  profissional ainda não tem grade de horários." com link para `/app/config/profissionais/:id/horarios`
  (só se o papel pode editar).

### 3.5 Mobile-first (RNF02) e performance (RNF01 < 1,5s)

- **Default no mobile = Lista** (a visão atual, já ótima no celular). Calendário **dia** é a segunda
  opção; **semana** no mobile vira "dia navegável" com setas (não tenta espremer 7 colunas).
- A grade de calendário renderiza só a **janela de horas relevante** (do primeiro expediente ao
  último do dia + folga visual), não 00–24 fixo, reduzindo DOM.
- Slots são **derivados** (sem request extra se calculados no cliente a partir de dados já em cache —
  ver §4.3), evitando waterfall. A query de agendamentos do dia já existe e é reusada.
- `localStorage` guarda a preferência de visão do usuário para a tela abrir já no modo escolhido
  (sem flash).

---

## 4. Arquitetura React (componentes vs. hooks vs. estado de servidor)

### 4.1 Regras invioláveis (steering)

- Dados de servidor **sempre** via TanStack Query; **nada** de `fetch`/`supabase` solto em
  `useEffect`. Cliente Supabase do browser com **anon key** + sessão; **RLS isola** — **nunca**
  enviar `tenant_id` do cliente para filtrar/contornar.
- Formulários com **react-hook-form** + resolver **zod**; mensagens pt-BR.
- Service role **jamais** no cliente. Se a geração de slots virar RPC/Edge, continua sob a sessão do
  usuário (RLS), não service role.

### 4.2 Hooks de dados novos (TanStack Query)

- `useScheduleOverrides(professionalId)` — lê `schedule_overrides` do profissional (RLS isola);
  mutations de criar/editar/remover com invalidação. Shape validado por zod (mesmo padrão de
  `useWorkingHours`).
- `useScheduleValidity(professionalId)` — lê/grava a vigência (D2). Se a vigência for coluna em
  `professionals`, reusa/estende o hook de profissionais; se for tabela, hook próprio. **O front
  trata como "um par de datas por profissional" — o mecanismo é decisão de dados.**
- `useAvailableSlots({ professionalId, serviceId, day })` — ver §4.3. Chave de query inclui
  `professionalId`, `serviceId`, `day` e o `appointmentId` em edição (para excluir o próprio
  ocupante). `enabled` só quando os três primeiros existem.

A query de agendamentos do dia (`useAppointments`) é **reusada** tanto pela lista quanto pelas visões
de calendário — mesma chave, sem duplicar request.

### 4.3 Onde roda a geração de slots — **recomendação do front**

**Recomendo computar os slots no cliente, em uma função pura** (`lib/scheduling-slots.ts`), a partir
de dados **já lidos sob RLS**: a grade (`working_hours`), as exceções (`schedule_overrides`), a
vigência (D2), os agendamentos ocupados do dia (`useAppointments`) e a `duration_minutes` do serviço.
O `useAvailableSlots` é então um `useQuery` (ou `useMemo` derivado) que orquestra essas leituras e
chama a função pura.

Justificativa:

- **Isolamento já garantido**: todos os insumos vêm por RLS; a função pura não toca `tenant_id` nem
  faz request privilegiado. Nada vaza entre tenants porque o cliente só enxerga o próprio tenant.
- **Testabilidade**: função determinística (grade + exceções + vigência + ocupados + duração →
  lista de inícios válidos), testável isolada com tabela de casos — espelha a disciplina de
  `lib/datetime.ts`. É o mesmo rigor que a tarefa exige ("defeito = slot ignorar ocupados/exceções/
  vigência/duração/fuso").
- **Performance (RNF01)**: sem round-trip extra; recomputa sob demanda ao mudar serviço/dia.
- **Fuso correto**: reusa `tenantDateTimeToUtc`/`toTenantLocal`/`addMinutes` — a grade é `HH:MM`
  local do tenant, convertida para UTC na borda para comparar com `starts_at`/`ends_at` (UTC). Essa
  é a fronteira onde o bug de fuso aconteceria; concentrá-la nos helpers já testados é a defesa.

**Alternativa considerada e descartada por ora**: RPC Postgres / Edge Function que devolve os slots.
Vale se a lógica precisar ser compartilhada com autoagendamento público (Fase 3, **fora de escopo**)
ou se o volume de agendamentos tornar o cálculo no cliente pesado. Como a lista do dia já é
carregada e o horizonte é um dia/semana por vez, o cálculo no cliente é suficiente e mais simples.
**Sinalizo ao planejamento/dados como ponto de decisão**: se eles preferirem a RPC por querer a regra
única no banco (como a não-sobreposição já é), o contrato do front (`useAvailableSlots` → lista de
`{ startUtc, endUtc }`) não muda — só a implementação de dentro.

### 4.4 Formulários (react-hook-form + zod)

- **Vigência** (`scheduleValiditySchema`): `validFrom` (data obrigatória), `validUntil` (opcional);
  refine `validUntil >= validFrom`. Datas tratadas como **data pura no fuso do tenant** (não
  instante), coerentes com a semântica de "período de atendimento".
- **Exceção** (`scheduleOverrideSchema`): `date` (obrigatória), `type` (`folga` | `horario_atipico`),
  e janela(s) só quando `horario_atipico` — reusa a validação de janela/intervalo de
  `workingHoursDaySchema` (início < fim; intervalo ambos-ou-nenhum, coerente e dentro da janela). Os
  schemas **espelham os CHECKs/constraints** que a análise de dados definir para `schedule_overrides`
  — a validação do cliente é UX; a trava é o banco.
- O `SlotPicker` **não** é um form próprio: escreve no campo `time` do `appointmentSchema` já
  existente (nenhuma mudança no schema de agendamento).

### 4.5 Estado local vs. servidor

- **Servidor** (TanStack Query): agendamentos do dia, grade, exceções, vigência, serviços,
  profissionais, clientes.
- **Local (useState / localStorage)**: visão escolhida (lista/dia/semana), dia/semana em foco, filtro
  de profissional, chip de slot selecionado no diálogo. Preferência de visão por **usuário** em
  `localStorage` (a tarefa foi explícita: toggle por usuário, não config de tenant).

---

## 5. Acessibilidade (obrigatório)

- **Contraste**: todos os textos usam pares de token já calibrados para **AA ≥ 4.5:1** (os `--status-*`
  foram calibrados para isso; corpo em `foreground` sobre `background`/`card`). A **linha do agora**
  em `--primary` é decoração — a informação de horário nunca depende só dela (há rótulos de hora e
  o `starts_at` textual no bloco). Folga/fora-de-vigência **não** se comunicam só por cor: têm rótulo
  textual ("Folga", "Fora do período de atendimento").
- **Teclado**: o `AgendaViewToggle` é um grupo navegável por setas com `aria-pressed`. Os chips de
  slot são `button`s tabuláveis com foco visível (o `focus-visible` do Button shadcn já entrega anel
  de foco); `Enter`/`Espaço` selecionam. Blocos de agendamento no calendário são focáveis e abrem o
  mesmo menu de ações da lista. Faixa vazia clicável do calendário também é alcançável por teclado
  (role `button` + `aria-label` "Criar agendamento às HH:MM").
- **Labels**: todo input de vigência/exceção tem `FormLabel` associado (o `Form` do shadcn já liga
  `htmlFor`/`id` e `aria-describedby` do `FormMessage`). O `SlotPicker` é um `radiogroup`
  (`role="radiogroup"` + `aria-label="Horários livres"`, chips como `radio`), para o leitor de tela
  anunciar "opção X de N".
- **Movimento**: a grade e a linha do agora respeitam `prefers-reduced-motion` (já global no
  `index.css`); sem animação de scroll forçada.
- **Estados comunicados a leitores de tela**: `aria-busy` nos esqueletos; slot indisponível **não é
  renderizado desabilitado**, é omitido (menos ruído para o leitor), com a contagem de slots anunciada
  no cabeçalho do grupo.
- **Nota de conformidade**: declaro os alvos de contraste e os padrões ARIA; a validação WCAG plena
  exige teste manual com tecnologia assistiva e revisão especializada — fica recomendado ao QA por ADR
  conferir foco/leitor de tela além do visual.

---

## 6. Copy (pt-BR, voz do produto)

- Toggle: **Lista · Dia · Semana**.
- Botão de criação inalterado: **Novo agendamento**.
- SlotPicker vazio por serviço: **"Nenhum horário livre para este serviço neste dia."**
- SlotPicker fora de vigência: **"Fora do período de atendimento do profissional."**
- SlotPicker em folga: **"O profissional não atende nesta data."**
- Sem grade: **"Este profissional ainda não tem grade de horários."** (+ link de configurar quando o
  papel permite).
- Vigência: rótulos **"Atende a partir de"** / **"Atende até"** + switch **"Sem data de término"**.
- Exceção — tipos: **"Folga / feriado"** e **"Horário diferente neste dia"**. Título do diálogo:
  **"Nova exceção na agenda"**. Erro de data duplicada: **"Já existe uma exceção para esta data."**
- Toasts seguem o padrão existente: **"Exceção salva."**, **"Exceção removida."**, **"Vigência
  salva."**, **"Agendamento criado."** (mesma voz dos toasts atuais).

Erros são diretos e dizem o que fazer; nada de "ops" ou tom de desculpa — coerente com os textos já
em tela.

---

## 7. Critério de aceite visual (verificável via Chrome DevTools no QA por ADR)

Fluxo em `/app/agenda` e `/app/config/profissionais/:id/horarios` (tenant autenticado):

1. **Toggle por usuário**: em `/app/agenda`, alternar **Lista → Dia → Semana** muda a renderização
   na própria tela sem recarregar; recarregar a página mantém a última visão escolhida (localStorage),
   sem flash para a lista.
2. **Calendário desenha a grade**: a visão Dia mostra calha de horas (tabular-nums), faixa de
   expediente distinta da faixa sem expediente, e a **linha do agora** em jade quando o dia em foco é
   hoje. Agendamentos aparecem como blocos com altura proporcional à duração e borda-lateral da cor do
   status (mesma do `StatusBadge`).
3. **Slots refletem a grade + exceções + vigência + ocupados**: no "Novo agendamento", escolher
   profissional + serviço de **1h** e um dia dentro da vigência → o `SlotPicker` lista inícios de 30 em
   30 que caibam 1h e não sobreponham agendamentos existentes. Trocar para um serviço de **2h** reduz
   as opções (só onde cabe o bloco de 2h). Escolher um dia marcado como **folga** → mensagem "O
   profissional não atende nesta data." e nenhum chip. Escolher um dia **fora da vigência** → mensagem
   de fora do período e nenhum chip.
4. **Fuso do tenant**: os horários dos chips e dos blocos aparecem no fuso do tenant
   (`America/Sao_Paulo` por padrão); um agendamento às 09:00 local aparece às 09:00 na grade e no chip,
   não deslocado por UTC.
5. **Criar a partir de um slot mantém a não-sobreposição**: selecionar um chip, confirmar → agendamento
   criado e visível no calendário/lista; tentar criar outro que sobreponha o mesmo profissional/horário
   → bloqueado com a **mesma** mensagem pt-BR de conflito (feedback local e, em corrida, a constraint do
   banco). Clicar numa faixa vazia do calendário abre o diálogo já com profissional+início preenchidos.
6. **Vigência e exceções (tela de horários)**: a grade semanal existente continua funcionando e salvando
   igual; abaixo dela, a seção de **vigência** salva início/fim e a de **exceções** adiciona/edita/remove
   uma data (folga ou horário atípico) com badge de tipo. Em papel sem permissão (recepção; ou professional
   na grade de outro), as seções aparecem em **leitura** (sem botões de salvar), espelhando a grade.
7. **Responsivo/mobile**: em viewport 360px, o default é Lista; a visão Dia é usável (scroll vertical das
   horas); a visão Semana degrada para dia navegável por setas; nenhum overflow horizontal quebrado.
8. **Acessibilidade observável**: foco visível ao tabular pelos chips de slot e pelos controles de visão;
   o grupo de slots é anunciado como radiogroup; nenhuma informação de status/folga comunicada só por cor.
9. **RBAC/guard**: um usuário `professional` vê só a própria agenda e edita só a própria vigência/exceções;
   `receptionist` vê a agenda de todos mas as seções de vigência/exceção ficam em leitura; nenhum dado
   financeiro aparece na agenda. (A trava real é o RLS; isto é a verificação de que a UI não oferece o que o
   papel não pode.)
10. **Build/typecheck limpos** e carregamento da agenda dentro do alvo (< 1,5s) na visão default.

---

## 8. Dependências de dados a confirmar com a análise de dados (bloqueiam a implementação plena)

1. **`schedule_overrides`** (D1): tabela nova multi-tenant, RLS + RBAC espelhando `working_hours`
   (admin qualquer; professional só a própria; receptionist leitura). Campos sugeridos p/ o front:
   `professional_id`, `date`, `type` (`folga`|`horario_atipico`) e, quando atípico, janela(s)
   (start/end + break opcional). Unicidade por `(professional_id, date)` evita exceções duplicadas na
   mesma data — o front mostra o erro "Já existe uma exceção para esta data."
2. **Vigência** (D2): onde moram `valid_from`/`valid_until` do profissional (coluna em `professionals`
   vs. tabela). O front consome como par de datas por profissional; a semântica é **data pura** no
   fuso do tenant.
3. **Passo-base/`slot_minutes`** (D4): se vira coluna em `professionals` nesta entrega ou fica como
   constante de UI (default 30). O front funciona com default; preparado para receber por profissional.
4. **Geração de slots** (D3): confirmar com dados se fica função pura no cliente (recomendação §4.3) ou
   RPC/Edge sob sessão do usuário. Contrato do front é estável nos dois casos.
5. **Não-sobreposição**: a constraint `tstzrange` por profissional **já existe** no banco — os slots a
   refletem (slot ocupado some), e o submit a respeita. Nenhuma mudança de constraint pedida pelo front.

---

## 9. Resumo para o planejamento

- **Toca tela em 3 frentes**, todas em `/app`: agenda (toggle calendário↔lista + criação por slot),
  diálogo de criação (SlotPicker), e tela de horários (vigência + exceções), **reusando** grade
  semanal, diálogo de agendamento, helpers de fuso, tokens de status e guards existentes.
- **Decisão de slots (front-loaded, §1):** híbrido — passo-base de início (default **30 min**, pode
  virar `professionals.slot_minutes` depois) ancorado na grade; o serviço consome o bloco da sua
  duração; só vira slot o início cujo bloco caiba na janela e não sobreponha ocupados/exceções; fora
  da vigência não há slot. **Sem materializar.**
- **Geração no cliente por função pura** a partir de dados lidos por RLS (recomendação §4.3), com fuso
  tratado nos helpers já testados; contrato estável se virar RPC.
- **Visual:** dissolve-se no "painel de operação calmo" existente; a grade de calendário é o elemento
  de destaque, mantida quieta em cor, com status como única cor saturada e a linha do agora em jade.
- **Dependências de dados** (§8): `schedule_overrides`, vigência, passo-base e a decisão
  cliente-vs-RPC da geração — sinalizadas; o front não inventa schema.
- **Verificação:** build/typecheck + QA ao vivo no `/app/agenda` conforme §7. Entrega local-only
  (branch + commit, sem push/PR).
