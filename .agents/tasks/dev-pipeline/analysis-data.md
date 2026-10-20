# Análise de Dados e Segurança — Evolução do módulo de Agenda (slots sob demanda, exceções/vigência, visão de calendário)

Papel: ANALISADOR DE DADOS E SEGURANÇA. Este documento cobre requisitos verificáveis, valor de
negócio, critérios de aceite testáveis, modelo de dados + migrations e políticas RLS/RBAC. Não
contém código de aplicação (frontend/edge) — isso é das etapas seguintes do pipeline.

> Nota de contexto: as ferramentas MCP do brain (`brain_search`/`brain_store`) **não estão
> expostas a este subagente**. A fonte da verdade usada foi `.kiro/steering/` (produto, domínio,
> stack, segurança-multitenant, convenções) + leitura direta das migrations e do código atual. A
> gravação do aprendizado no brain fica a cargo da orquestração ao fim do run (regra
> `brain-learning`).

---

## 1. Summary

A agenda hoje é uma **lista vertical por profissional/dia** (`AgendaPage.tsx`) que **não gera
slots** (comentário explícito no arquivo) e depende do usuário digitar data+hora livre no
`AppointmentFormDialog`. A grade semanal recorrente (`working_hours`) já existe e é reusável, mas
hoje serve só à tela de configuração — não alimenta a oferta de horários.

A demanda evolui o módulo em três frentes, **sem reescrever** o que existe:

1. **Geração de slots sob demanda** a partir de `working_hours` − exceções por data − vigência −
   agendamentos ocupados, onde o **encaixe consome a duração do serviço** escolhido
   (`services.duration_minutes`, ex.: 1h/2h), com um **passo-base de slot** por profissional.
2. **Exceções por data** (folga/feriado/horário atípico) — nova entidade multi-tenant
   `schedule_overrides` que sobrescreve a grade naquele dia.
3. **Vigência da grade por profissional** (período início/fim em que o profissional atende).
4. **Visão de calendário (dia/semana)** que o **usuário** alterna com a lista atual na própria
   tela (preferência por usuário, não config de tenant).

Do ponto de vista de **dados/segurança**, a demanda toca o banco em dois pontos: (a) uma **nova
tabela de domínio** (`schedule_overrides`) que precisa de `tenant_id` + índice + RLS + RBAC
espelhando `working_hours`; (b) **colunas de vigência + passo-base** (decisão: onde morar — ver
§5). A geração de slots **não** materializa nada no banco (restrição dura: gerar sob demanda) e,
por ser leitura derivada de tabelas já isoladas por RLS, não cria superfície de vazamento nova —
desde que **todo cálculo leia pelo cliente sob RLS** e **nunca** receba `tenant_id` do cliente.

A invariante crítica de integridade — **não-sobreposição por profissional** — já é dona do banco
(constraint de exclusão `appointments_no_overlap`, `tstzrange` + `btree_gist`, isolada por
`tenant_id`). A geração de slots e o calendário são camadas de **oferta/visualização**; a trava
real continua no banco e **não pode ser enfraquecida**.

---

## 2. Valor de negócio e enquadramento no roadmap

- **Produto (Fase 1 / MVP):** o core do Atlas Agenda é agenda + régua de cobrança. Gerar slots
  livres reduz erro de marcação (marcar fora do expediente, em folga, ou sobre outro
  atendimento) e acelera o fluxo da recepção — alinhado ao objetivo de **reduzir no-show** e dar
  previsibilidade. Exceções por data (feriado/folga) e vigência são requisitos reais de clínica
  que o MVP ainda não cobria.
- **Dentro de escopo (confirmado pelo usuário e pelo brief):** grade recorrente (reuso), exceções
  por data, vigência, geração de slots pela grade + duração do serviço, toggle calendário↔lista
  por usuário.
- **Fora de escopo (Fase 3, não implementar):** link público de autoagendamento, taxa de reserva
  antecipada, painel de métricas. Também **fora**: webhooks, PIX, WhatsApp e demais módulos.
- **Planos/limites:** não altera a estrutura de planos. O limite de 150 agendamentos/mês do plano
  Individual é regra de assinatura já existente e **não** é reaberto aqui.

---

## 3. Requisitos funcionais (verificáveis)

- **RF-AG-01 — Vigência da grade.** Cada profissional tem um período de vigência de atendimento
  (`schedule_start_date`, `schedule_end_date`, ambos opcionais/nulos = sem limite). Fora da
  vigência não há slots, mesmo que a grade semanal tenha faixa para o dia.
- **RF-AG-02 — Exceções por data.** Uma exceção por data sobrescreve a grade naquele dia para um
  profissional: pode ser **bloqueio total** (folga/feriado: nenhum slot) ou **janela atípica**
  (horário diferente do recorrente, com intervalo opcional).
- **RF-AG-03 — Geração de slots sob demanda.** Para `(profissional, serviço, dia)` o sistema
  calcula os horários de início livres: parte da janela do dia (exceção se houver, senão a grade
  semanal do `weekday`), desconta o intervalo (break), aplica a vigência, remove os horários cujo
  bloco `[início, início + duração_do_serviço)` sobrepõe um agendamento **ativo**
  (`status not in ('cancelado','nao_compareceu')`) do profissional, e remove horários no passado
  (relativo a agora, no fuso do tenant).
- **RF-AG-04 — Encaixe pela duração do serviço.** O bloco ofertado tem tamanho
  `services.duration_minutes`; o início anda pelo **passo-base de slot** do profissional (ver §5
  para a decisão). Um serviço de 1h ou 2h só é ofertado quando **cabe inteiro** dentro da janela
  (não cruza o fim do expediente, o break, nem um agendamento ocupado).
- **RF-AG-05 — Criar agendamento a partir de um slot.** Selecionar um slot pré-preenche
  profissional/serviço/início no fluxo de criação já existente (`AppointmentFormDialog`), e a
  criação continua sujeita à checagem de conflito local + à constraint de não-sobreposição do
  banco.
- **RF-AG-06 — Visão de calendário alternável.** A `AgendaPage` oferece um **toggle** calendário
  (dia/semana) ↔ lista, por **escolha do usuário** (preferência do usuário, não do tenant),
  persistida localmente por usuário; a lista atual permanece disponível.
- **RF-AG-07 — Fuso do tenant.** Toda a oferta de slots e a exibição do calendário/lista
  respeitam o fuso do tenant (`tenants.timezone`, default `America/Sao_Paulo`); instantes
  persistidos continuam em `timestamptz` UTC.
- **RF-AG-08 — Reuso, não regressão.** A grade semanal (`working_hours` + `WeekScheduleForm` +
  `HorariosPage`) e o fluxo de criação de agendamento atuais continuam funcionando sem mudança de
  contrato observável; a máquina de estados e a não-sobreposição ficam intactas.

---

## 4. Requisitos não-funcionais e de segurança (invioláveis)

- **RNF-SEG-01 — Isolamento multi-tenant por RLS.** A nova tabela `schedule_overrides` tem
  `tenant_id uuid not null default current_tenant_id()`, índice por `tenant_id`, RLS **habilitado**
  e políticas USING + WITH CHECK ancoradas em `current_tenant_id()`. Nunca recebe `tenant_id` do
  cliente.
- **RNF-SEG-02 — `tenant_id` do JWT.** Todo filtro e escrita derivam o tenant de
  `current_tenant_id()` (helper `security definer` já existente). A geração de slots lê
  `working_hours`/`appointments`/`schedule_overrides`/`services` **pelo cliente sob RLS** — o
  isolamento é do banco, não do parâmetro.
- **RNF-SEG-03 — RBAC preservado.**
  - `admin`: escreve vigência e exceções de qualquer profissional do tenant.
  - `professional`: escreve **só as próprias** exceções/vigência (profissional cujo
    `profile_id = auth.uid()`), espelhando a policy `working_hours_write_own_professional`.
  - `receptionist`: **leitura** de grade/exceções/vigência (precisa ver disponibilidade para
    marcar), **sem** acesso a `charges`/dados financeiros (inalterado — esta demanda não toca
    `charges`).
  - `super_admin`: nenhum caminho cross-tenant pelo cliente (fase futura via service role/Edge).
- **RNF-SEG-04 — Não-sobreposição no banco.** A constraint `appointments_no_overlap`
  (`exclude using gist` por `tenant_id` + `professional_id` + `tstzrange(starts_at, ends_at)`,
  partial `where status not in ('cancelado','nao_compareceu')`) é a fonte da verdade e **não é
  alterada**. A geração de slots apenas **reflete** ocupados; criar a partir de um slot ainda
  passa pela constraint (defesa contra corrida).
- **RNF-SEG-05 — Tempo em UTC.** `timestamptz` UTC no banco; horas de grade/exceção em `time`
  (`HH:MM`); conversão para o fuso do tenant só na borda da UI (`src/lib/datetime.ts`, sem lib
  externa).
- **RNF-SEG-06 — Schema versionado.** Toda mudança é **migration nova** em
  `supabase/migrations` (nunca editar migration aplicada); idempotente no re-apply.
- **RNF-SEG-07 — Sem segredos.** Nenhum segredo em SQL ou no bundle do cliente. Esta demanda não
  envolve service role/Edge Function nem integrações externas.
- **RNF-SEG-08 — Dados não confiáveis.** Entradas de formulário (vigência/exceção, serviço/dia da
  geração de slots) validadas com **zod** espelhando os CHECKs do banco, antes de usar.

---

## 5. Decisão de modelagem a resolver no planejamento (recomendação, não chute)

**Tensão:** "grade de slots com passo fixo (ex. 30 em 30 min)" vs "slot pela duração do serviço".

**Recomendação (a documentar e fixar no design):**

- A **disponibilidade** é a grade/exceção/vigência do profissional (janela contínua menos break
  menos ocupados). A **oferta de horários de início** anda por um **passo-base de slot por
  profissional** (`slot_step_minutes`), default **30**; o **tamanho do bloco** ofertado/consumido
  é a **duração do serviço selecionado** (`services.duration_minutes`). Assim, um serviço de 2h
  numa grade 08:00–12:00 com passo 30 oferece inícios em 08:00, 08:30, 09:00, 09:30, 10:00
  (último início que ainda cabe 2h antes das 12:00), descontando ocupados.
- **Por quê:** o exemplo do usuário é uma clínica com serviços de 1h/2h. Fixar o bloco na duração
  do serviço respeita a fala do usuário ("1h/2h ocupam os slots do profissional"); o passo-base
  dá granularidade de início sem obrigar a cadastrar grade "de 30 em 30". Um passo configurável
  por profissional cobre o caso de agendas com granularidade diferente (ex.: psicologia de 50min,
  passo 10/15). Alternativa descartada: passo fixo global — menos flexível e some com o caso de
  profissionais com ritmos distintos no mesmo tenant.
- **"Tempo-base de atendimento próprio do profissional":** modelar como o **passo-base**
  (`slot_step_minutes`) — é exatamente a granularidade com que os inícios do profissional andam.
  Não introduzir um "duração padrão do profissional" concorrente à duração do serviço: a duração
  do agendamento vem **sempre** do serviço (já é snapshot em `appointments.price_cents`/`ends_at`,
  ADR-02/08); o profissional controla só o passo de oferta.

**Onde as colunas de vigência + passo-base moram:** adicionar a `professionals`
(`schedule_start_date date`, `schedule_end_date date`, `slot_step_minutes int`), porque são
atributos **do profissional** (uma vigência e um passo por profissional), não da grade semanal
(que é 0..7 linhas por profissional). Alternativa descartada: pôr vigência em `working_hours` —
duplicaria o dado por linha de dia e abriria inconsistência (vigências divergentes entre dias).

> **Ponto aberto para o gate humano do PRD:** confirmar (a) passo-base default 30 e configurável
> por profissional; (b) vigência e passo em `professionals` (vs tabela de settings dedicada). A
> recomendação acima é a leitura mais fiel; o planejador deve registrar a escolha final.

---

## 6. Modelo de dados e migrations

Todas as mudanças em **migrations novas** (timestamps posteriores à última aplicada,
`20250220091000_messages.sql`). Horas de grade/exceção em `time`; datas de vigência/exceção em
`date` (dia de calendário no fuso do tenant — a conversão para instantes UTC acontece na geração
de slots, na borda); dinheiro inalterado; `tenant_id` com default `current_tenant_id()`.

### 6.1 `professionals` — colunas de vigência + passo-base (ALTER, migration nova)

```
alter table professionals
  add column if not exists schedule_start_date date,           -- vigência: início (null = sem limite)
  add column if not exists schedule_end_date   date,           -- vigência: fim   (null = sem limite)
  add column if not exists slot_step_minutes   int not null default 30
    check (slot_step_minutes between 5 and 240);

-- coerência da vigência: quando ambos presentes, início <= fim.
alter table professionals
  add constraint professionals_schedule_vigencia_coherent
  check (
    schedule_start_date is null
    or schedule_end_date is null
    or schedule_start_date <= schedule_end_date
  );
```

Observações:
- Sem nova coluna `tenant_id` (já existe). RLS/policies de `professionals` **já cobrem** essas
  colunas — `professionals_write_admin` permite ao admin editar; o `professional` **não** tem
  policy de escrita em `professionals` hoje (só em `working_hours`). **Decisão de design a
  confirmar:** se o `professional` deve poder editar a própria vigência/passo, é preciso uma
  policy `professionals_update_own` restrita às colunas de schedule — ver §7, RBAC. Recomendação:
  vigência/passo são configuração de agenda que o próprio profissional deveria ajustar; adicionar
  policy own-update **apenas** para essas colunas via `WITH CHECK` + (idealmente) coluna-level
  grants, OU manter admin-only no MVP e deixar explícito. Recomendo **admin-only no MVP** para não
  ampliar superfície de escrita em `professionals` (que carrega `profile_id`, `active`), com nota
  de backlog para own-update granular.

### 6.2 `schedule_overrides` — exceções por data (nova tabela de domínio)

```
create table if not exists schedule_overrides (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  professional_id uuid not null,
  override_date   date not null,                         -- dia de calendário (fuso do tenant)
  -- is_closed = true  -> bloqueio total (folga/feriado): nenhum slot nesse dia.
  -- is_closed = false -> janela atípica: start_time/end_time obrigatórios (sobrescreve a grade).
  is_closed       bool not null default false,
  start_time      time,
  end_time        time,
  break_start     time,
  break_end       time,
  reason          text check (reason is null or char_length(reason) <= 200),  -- rótulo opcional (ex.: "Feriado")
  created_at      timestamptz not null default now(),
  constraint schedule_overrides_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete cascade,
  -- uma exceção por (profissional, data): evita grades atípicas ambíguas no mesmo dia.
  constraint schedule_overrides_unique unique (tenant_id, professional_id, override_date),
  -- coerência: fechado não tem janela; aberto exige janela coerente e break ambos-ou-nenhum,
  -- dentro da janela (espelha working_hours_window / working_hours_break_coherent).
  constraint schedule_overrides_window check (
    (is_closed = true  and start_time is null and end_time is null
       and break_start is null and break_end is null)
    or (is_closed = false and start_time is not null and end_time is not null
       and start_time < end_time
       and (
         (break_start is null and break_end is null)
         or (break_start is not null and break_end is not null
             and start_time <= break_start and break_start < break_end and break_end <= end_time)
       ))
  )
);

create index if not exists schedule_overrides_tenant_id_idx
  on schedule_overrides (tenant_id);
-- consulta da geração de slots: exceções de um profissional numa janela de datas.
create index if not exists schedule_overrides_tenant_professional_date_idx
  on schedule_overrides (tenant_id, professional_id, override_date);

alter table schedule_overrides enable row level security;
```

**Decisões de modelagem:**
- **Uma exceção por (profissional, data)** (`unique`): evita ambiguidade de qual janela vale e
  simplifica a geração (lookup O(1) por dia). O "feriado do tenant inteiro" fica para Fase futura
  (seria uma exceção por profissional ou uma tabela `tenant_holidays` — **fora de escopo** aqui;
  não inventar).
- **`is_closed` + janela única** cobre os dois casos do usuário (folga/feriado = fechado; horário
  atípico = janela). Não modelar múltiplas faixas por dia no MVP (a grade semanal também é faixa
  única + break); manter paridade com `working_hours`.
- **`date`, não `timestamptz`:** exceção é um dia de calendário no fuso do tenant; a conversão
  para instantes UTC (início/fim do dia) é feita na geração de slots, como `tenantDayRangeUtc` já
  faz para a lista.

### 6.3 RLS de `schedule_overrides` (espelha `working_hours`)

```
-- SELECT: qualquer papel do tenant lê (recepção precisa ver disponibilidade para marcar).
drop policy if exists schedule_overrides_select_same_tenant on schedule_overrides;
create policy schedule_overrides_select_same_tenant on schedule_overrides for select
  using (tenant_id = current_tenant_id());

-- WRITE: admin escreve exceção de qualquer profissional do tenant.
drop policy if exists schedule_overrides_write_admin on schedule_overrides;
create policy schedule_overrides_write_admin on schedule_overrides for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- WRITE: professional escreve APENAS as próprias exceções (profissional do seu profile_id).
drop policy if exists schedule_overrides_write_own_professional on schedule_overrides;
create policy schedule_overrides_write_own_professional on schedule_overrides for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = schedule_overrides.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'professional'
    and exists (
      select 1 from professionals p
      where p.id = schedule_overrides.professional_id
        and p.tenant_id = current_tenant_id()
        and p.profile_id = auth.uid()
    )
  );
-- receptionist: sem policy de escrita -> só leitura. super_admin: sem caminho cross-tenant aqui.
```

### 6.4 Geração de slots — **sem tabela** (restrição dura)

Nunca materializar slots. O cálculo é **leitura derivada** no cliente (TanStack Query) ou, se o
design preferir centralizar, numa **função SQL `stable`** `security invoker` (roda sob a RLS do
chamador — herda o isolamento, não é `security definer`). **Recomendação:** começar no cliente
(reusa `src/lib/datetime.ts`, testável como função pura, sem round-trip extra e sem superfície
nova no banco); só migrar para RPC se a performance (RNF01, agenda < 1,5s) exigir. Em ambos os
casos o insumo (`working_hours`, `schedule_overrides`, `appointments` ativos, `services`) já é
lido sob RLS — **nenhuma** leitura cross-tenant possível.

---

## 7. Critérios de aceite testáveis (numerados)

1. **AC-01 (isolamento):** um usuário do tenant A **não** lê nem escreve `schedule_overrides` do
   tenant B (teste: autenticar como A e tentar `select`/`insert` com `professional_id` de B →
   0 linhas / erro RLS).
2. **AC-02 (tenant_id do servidor):** `insert` em `schedule_overrides` **sem** `tenant_id` grava
   com o tenant do JWT (default `current_tenant_id()`); enviar `tenant_id` de outro tenant é
   barrado pelo `WITH CHECK`.
3. **AC-03 (RBAC admin):** `admin` cria/edita exceção e vigência de qualquer profissional do
   tenant.
4. **AC-04 (RBAC professional):** `professional` cria/edita exceção **só** do profissional ligado
   ao seu `profile_id`; tentar gravar exceção de outro profissional é negado por RLS.
5. **AC-05 (RBAC receptionist):** `receptionist` **lê** grade/exceções/vigência (vê
   disponibilidade) e **não** grava exceção (sem policy de escrita); nenhum acesso a `charges`
   permanece verdadeiro (inalterado).
6. **AC-06 (coerência da exceção):** exceção `is_closed=true` com `start_time`/`end_time`
   preenchidos é rejeitada pelo CHECK; exceção `is_closed=false` sem janela, ou com break fora da
   janela, é rejeitada.
7. **AC-07 (unicidade da exceção):** dois `insert` de exceção para o mesmo
   `(professional_id, override_date)` falham no `unique`.
8. **AC-08 (coerência da vigência):** `schedule_start_date > schedule_end_date` é rejeitado pelo
   CHECK; `slot_step_minutes` fora de 5..240 é rejeitado.
9. **AC-09 (slots refletem a grade):** para um profissional com `working_hours` no `weekday`, os
   slots ofertados ficam dentro da janela e fora do break.
10. **AC-10 (slots refletem exceção-fechado):** num dia com exceção `is_closed=true`, **nenhum**
    slot é ofertado, mesmo havendo grade semanal para o `weekday`.
11. **AC-11 (slots refletem exceção-janela):** num dia com exceção `is_closed=false`, os slots
    seguem a janela **da exceção** (não a da grade).
12. **AC-12 (slots refletem vigência):** fora de `[schedule_start_date, schedule_end_date]` não há
    slots; dentro, há (quando a grade/exceção permite).
13. **AC-13 (slots refletem ocupados):** um horário cujo bloco `[início, início+duração)`
    sobrepõe um agendamento ativo não é ofertado; agendamentos `cancelado`/`nao_compareceu` não
    bloqueiam.
14. **AC-14 (encaixe pela duração):** serviço de 1h e de 2h consomem blocos de 60/120 min; um
    início só é ofertado se o bloco inteiro cabe antes do fim da janela/break/próximo ocupado.
15. **AC-15 (passo-base):** os inícios ofertados andam de `slot_step_minutes` em
    `slot_step_minutes` a partir do começo da janela.
16. **AC-16 (fuso):** slots e exibição usam `tenants.timezone`; um agendamento às 09:00
    local aparece às 09:00 e o slot correspondente some, independentemente do fuso do servidor.
17. **AC-17 (passado):** horários anteriores a "agora" (no fuso do tenant) não são ofertados para
    o dia corrente.
18. **AC-18 (criar a partir de slot):** criar agendamento a partir de um slot preenche
    profissional/serviço/início e, em corrida, a constraint `appointments_no_overlap` (23P01)
    ainda barra a sobreposição com mensagem pt-BR.
19. **AC-19 (toggle por usuário):** a `AgendaPage` alterna calendário (dia/semana) ↔ lista por
    escolha do usuário; a preferência persiste por usuário (local) e não vira config de tenant.
20. **AC-20 (sem regressão):** `WeekScheduleForm`/`HorariosPage` e o fluxo atual de criar/editar
    agendamento continuam funcionando; a máquina de estados e a não-sobreposição seguem
    intactas; `build`/`typecheck` limpos.
21. **AC-21 (sem materialização):** nenhuma tabela/coluna de "slots" é criada; a disponibilidade é
    derivada sob demanda.

---

## 8. Edge cases de dados/segurança a cobrir no design

- **Exceção vs vigência vs grade — precedência:** ordem de resolução por dia = **vigência**
  (fora → sem slots) → **exceção** (fechado → sem slots; janela → usa a janela da exceção) →
  **grade semanal** do `weekday` (sem exceção e dentro da vigência). Documentar essa cascata no
  design para o gerador não divergir.
- **Horário de verão:** fatiar sempre no fuso do tenant e persistir em UTC; `src/lib/datetime.ts`
  já trata o offset por instante (duas passadas na transição de DST). Reusar, não reimplementar.
- **Duração > janela:** serviço cuja duração não cabe em nenhum ponto da janela → nenhum slot
  (não é erro, é vazio honesto).
- **Grade com múltiplas linhas por weekday:** `working_hours` é permissivo (sem unicidade por
  `(professional_id, weekday)`); o gerador deve lidar com 0..N faixas por dia (união das janelas)
  sem assumir faixa única.
- **Profissional sem grade/sem vínculo:** sem `working_hours` no dia → sem slots; `professional`
  sem `professionals` vinculado já cai no estado vazio honesto da `AgendaPage` (inalterado).
- **Corrida:** dois usuários pegando o mesmo slot — a constraint do banco é a árbitra; a oferta de
  slots é otimista e a mensagem de conflito pt-BR já existe (`mapSchedulingError`).
- **`receptionist` e financeiro:** nada nesta demanda abre `charges` à recepção; manter.

---

## 9. Validação de entradas externas (zod espelhando o banco)

- **Vigência:** `schedule_start_date`/`schedule_end_date` datas ISO (`YYYY-MM-DD`) opcionais;
  quando ambas, início ≤ fim. `slot_step_minutes` inteiro 5..240. Mensagens pt-BR.
- **Exceção:** `override_date` obrigatória; `is_closed` boolean; se aberto, `start_time`/`end_time`
  `HH:MM` com início < fim e break ambos-ou-nenhum dentro da janela (reusar a lógica de
  `workingHoursDaySchema`); `reason` ≤ 200 chars. Se fechado, janela/break ausentes.
- **Geração de slots (entrada da query):** `professionalId`/`serviceId` uuid, `day` `YYYY-MM-DD`.
  **Nunca** aceitar `tenant_id` do cliente.
- Falha de validação → recusa com mensagem pt-BR; a trava final é o CHECK/RLS no Postgres.

---

## 10. Ownership de invariantes (quem garante o quê)

- **Não-sobreposição por profissional:** **banco** (constraint de exclusão). Oferta de slots e
  checagem local são UX/feedback.
- **Isolamento tenant:** **banco** (RLS + default `current_tenant_id()` + FKs compostas por
  tenant). App nunca envia `tenant_id`.
- **RBAC escrita de exceção/vigência:** **banco** (policies). UI esconde botões (defesa em
  profundidade).
- **Coerência de janela/vigência:** **banco** (CHECKs) + **zod** na borda.
- **Fuso/encaixe pela duração:** **app** (gerador de slots determinístico) — testável por unidade.

---

## 11. Testabilidade

- **Unit (app):** o gerador de slots é função pura (grade/exceção/vigência/ocupados/duração/passo
  → lista de inícios) — cobrir a cascata de precedência, DST, duração > janela, break, passado.
- **Integração (banco):** RLS cross-tenant (AC-01/02), RBAC (AC-03..05), CHECKs e `unique`
  (AC-06..08) via `supabase start` + sessões de papéis distintos.
- **E2E/QA ao vivo (`/app/agenda`, chrome-devtools):** AC-09..19 — slots refletindo tudo no fuso,
  toggle calendário↔lista, criar a partir de slot sem sobreposição.

---

## 12. Resumo das migrations propostas (nomes)

1. `<ts>_professionals_schedule_vigencia.sql` — ALTER `professionals`: `schedule_start_date`,
   `schedule_end_date`, `slot_step_minutes` + CHECKs.
2. `<ts>_schedule_overrides.sql` — nova tabela `schedule_overrides` + índices + CHECKs + RLS/RBAC.

(Opcional, só se o design optar por RPC) `<ts>_available_slots_fn.sql` — função SQL `stable`
`security invoker` que gera slots sob demanda, sem materializar. Recomendação: **não** criar no
MVP; manter o cálculo no cliente.

---

## 13. Pontos que permanecem para o gate humano do PRD / planejamento

- Confirmar o modelo de slots: **passo-base por profissional (default 30) + bloco = duração do
  serviço** (recomendado em §5).
- Confirmar que vigência + passo moram em `professionals` (recomendado) vs tabela de settings.
- Confirmar RBAC de escrita de vigência/passo: **admin-only no MVP** (recomendado) vs permitir
  own-update do `professional` com policy granular.
- Confirmar que "feriado do tenant inteiro" fica **fora** do MVP (exceção é por profissional/data).

Nenhum ponto levantado pelo usuário foi descartado: exceções por data **e** vigência, geração/
exibição de slots livres, duração vinda do serviço (1h/2h ocupam os slots), e toggle de visão por
usuário estão todos mapeados em RF/AC acima.
