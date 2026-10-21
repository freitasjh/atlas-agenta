# Análise de Dados e Segurança — Fatia 2 do WhatsApp (Fase 2)

Confirmação interativa D-1: lembrete numérico automático (cron) + webhook de entrada da Evolution
+ marcar agendamento `confirmado` + fila de retentativa.

> Papel deste documento: requisitos verificáveis, critérios de aceite testáveis, **modelo de
> dados + migrations + RLS**, e enquadramento no roadmap. Não contém código de aplicação. As
> decisões de arquitetura de runtime (desenho do webhook, backoff, cron) são refinadas pelo
> passo de design; aqui fixo o que o schema e as invariantes de segurança **exigem**.

---

## 1. Resumo

Hoje o projeto só dispara WhatsApp **sob demanda** (Edge Function `whatsapp`, operação `send`,
Fatia 1). Esta fatia introduz, pela **primeira vez no projeto**, dois mecanismos novos:

1. **Disparo automático agendado** (pg_cron) do lembrete D-1 (`lembrete_d1`), varrendo
   agendamentos com `starts_at` ~24h à frente, ainda não lembrados, com opt-in.
2. **Webhook de ENTRADA** da Evolution (nova Edge Function) que recebe a resposta do cliente,
   valida (zod), verifica autenticidade, é idempotente, casa a resposta ao agendamento certo do
   tenant certo e aplica a transição de estado: `1` → `confirmado` + `confirmed_at`; `2` →
   mensagem automática de retorno, **sem** alterar o agendamento (decisão "c" do usuário).
3. **Fila de retentativa** para `messages.status = 'fila'`: reenvio com backoff e limite N,
   marcando `falha` só após o limite e **nunca** reenviando após a janela útil do lembrete
   (depois de `starts_at`).

O texto do `lembrete_d1` já traz "Responda 1 para confirmar ou 2 para reagendar" (baseline da
Fatia 1, migration `20250222091000`). A régua de templates server-side, opt-in, idempotência de
**envio** (`dedupe_key` + índice único parcial), checagem de instância conectada, normalização
E.164 e o adapter Evolution (mock/real) já existem e **devem ser reusados, não recriados**.

### Fronteiras invioláveis aplicadas a esta fatia

- RLS habilitado em **toda** tabela de domínio nova; nenhuma tabela de tenant sem política.
- `tenant_id` **nunca** vem do payload do webhook. Na superfície de webhook (pré-autenticação,
  sem JWT de usuário) o tenant é resolvido **pela instância** (`whatsapp_instances`
  `.evolution_instance_name` → `tenant_id`), no servidor, com service role.
- Operações privilegiadas (webhook, cron, transição de status, escrita em `messages`) rodam em
  Edge Function / função SQL `security definer` com service role. Segredos (token Evolution,
  service role, segredo de webhook) **só** no servidor/env, nunca no bundle do cliente.
- Idempotência obrigatória: processar o mesmo evento de entrada duas vezes **não** confirma em
  duplicidade nem gera efeito repetido. Chave de dedupe = id da mensagem/evento da Evolution.
- Autenticidade do webhook verificada **antes** de qualquer efeito.
- Disparo só com `whatsapp_opt_in = true` (LGPD). Sem telefone/texto em claro em log.

---

## 2. Requisitos funcionais

**RF-S2-01 — Lembrete D-1 automático (cron).** Um job agendado (pg_cron) executa periodicamente
e dispara o template `lembrete_d1` para todo agendamento elegível: `status in ('pendente',
'confirmado')`, `starts_at` dentro da janela ~24h à frente (faixa configurável, p.ex. 23h–25h),
cliente com `whatsapp_opt_in = true`, instância do tenant `conectado`, e que ainda **não** teve
lembrete D-1 enfileirado/enviado. O job **não** reenvia após `starts_at` (janela útil vencida).

**RF-S2-02 — Marcação idempotente de "lembrado".** Cada agendamento recebe no máximo um lembrete
D-1 por ciclo. A elegibilidade deriva da existência (ou não) de uma `messages` com
`template = 'lembrete_d1'` viva para aquele `appointment_id` — reusando a `dedupe_key` existente
(`lembrete_d1:a:<appointmentId>`). Rodar o cron duas vezes seguidas não gera dois lembretes.

**RF-S2-03 — Webhook de entrada (nova Edge Function).** Uma Edge Function pública recebe o POST
de mensagem recebida da Evolution. Ela: (a) verifica autenticidade; (b) valida o payload com zod
(dado não confiável); (c) deduplica pelo id do evento/mensagem; (d) resolve o tenant pela
instância; (e) casa a resposta ao agendamento; (f) aplica o efeito. Payload inválido ou não
autêntico é **rejeitado sem efeito**.

**RF-S2-04 — Casamento resposta → agendamento (determinístico).** A partir do telefone do
remetente normalizado em E.164 + o tenant resolvido pela instância, encontrar o **agendamento
alvo**: o agendamento do cliente (via `customers.phone` no tenant) com `status in ('pendente',
'confirmado')`, que teve `lembrete_d1` enviado, cujo `starts_at` está no futuro (janela útil
ainda aberta), escolhendo o de **`starts_at` mais próximo**. Se não casar nenhum, o evento é
**logado e ignorado** (sem erro ao provedor, sem efeito).

**RF-S2-05 — Resposta "1" confirma.** Com um agendamento casado e resposta interpretada como
`1` (confirmar), a Edge Function transiciona `appointments.status → 'confirmado'` via UPDATE
(respeitando o trigger `appointments_transition_guard`, que carimba `confirmed_at`). Transição
inválida (ex.: agendamento já `cancelado`) é tratada sem erro fatal e logada.

**RF-S2-06 — Resposta "2" retorna mensagem automática (decisão c).** Resposta interpretada como
`2` (reagendar): a função **não** altera o agendamento. Enfileira uma mensagem automática de
retorno ("entramos em contato para reagendar") — via `messages` + adapter. Nenhum reagendamento
automático, nenhuma mudança de horário.

**RF-S2-07 — Resposta não reconhecida.** Texto que não casa `1`/`2` (após normalização: trim,
primeiro token, tolerância a "1 confirmar") é logado e ignorado — sem efeito e sem resposta
automática obrigatória (o design decide se há uma resposta "não entendi"; mínimo: ignorar).

**RF-S2-08 — Fila de retentativa.** Um worker agendado (pg_cron) varre `messages.status = 'fila'`
cujo disparo via adapter não concluiu, e reenvia com **backoff** respeitando um **limite N** de
tentativas. Atingido N, marca `status = 'falha'` com `failure_reason`. **Nunca** reenvia um
lembrete D-1 após o `starts_at` do agendamento associado (janela útil vencida → marca `falha`
com motivo de janela, não tenta mais).

**RF-S2-09 — Confirmação enviada registrada.** Toda mensagem de resposta automática (RF-S2-06) é
registrada em `messages` com opt-in, idempotência e PII mínima, igual ao fluxo `send` da Fatia 1.

---

## 3. Requisitos não funcionais

- **RNF-S2-01 (isolamento multi-tenant, inegociável).** Webhook e cron nunca cruzam tenants. No
  webhook, o tenant vem da instância; o casamento filtra por `tenant_id`. No cron, cada linha
  processada carrega seu `tenant_id`.
- **RNF-S2-02 (idempotência).** Evento de entrada processado no máximo uma vez (dedupe por id do
  evento). Lembrete D-1 enfileirado no máximo uma vez por agendamento/ciclo.
- **RNF-S2-03 (autenticidade).** Webhook verifica token/assinatura antes de qualquer leitura de
  negócio. Segredo do webhook em env, nunca no cliente.
- **RNF-S2-04 (LGPD / PII).** Disparo só com opt-in. `messages.payload` e logs **sem** telefone,
  documento ou texto em claro. O telefone recebido do webhook não é persistido em claro em
  `webhook_events` — só o necessário para dedupe/diagnóstico, e preferencialmente hasheado ou
  omitido.
- **RNF-S2-05 (segredos no servidor).** Token Evolution, service role e segredo do webhook só em
  Edge Functions / secrets. Nenhum `VITE_*`.
- **RNF-S2-06 (resiliência).** Falha temporária não perde mensagem (fila + retentativa). Erros do
  provedor/rede são não-fatais e registrados.
- **RNF-S2-07 (versionamento).** Todo schema e todo agendamento de cron em **migration** nova;
  nunca editar migration já aplicada. Mudança ao enum de `messages.template` (ver §5) é migration
  nova.

---

## 4. Enquadramento no roadmap

Produto (produto.md): a confirmação interativa D-1 é objetivo central — **reduzir no-show**.
A skill whatsapp-evolution lista isto como RF10/RF11 + RNF04 (fila de retentativa). Esta é a
**Fatia 2 da Fase 2 do WhatsApp**, logo após a Fatia 1 (templates + render server-side, já em
`master`).

- **Entra agora:** lembrete D-1 automático (cron), webhook de entrada, confirmação por resposta
  numérica `1`, resposta `2` = mensagem automática de retorno (tratamento manual), fila de
  retentativa.
- **Fora (Fase 3 / outras fatias):** botões interativos (resposta é **numérica**),
  reagendamento automático, autoagendamento público e métricas consolidadas, módulo Asaas/PIX
  (`cobranca`/`comprovante` seguem só sob demanda nesta fatia).

Precedência correta: a máquina de estados de `appointments` (confirmado + `confirmed_at`) e a
tabela `messages` com idempotência de envio já existem — esta fatia **consome** essas fundações.

---

## 5. Modelo de dados e migrations

Princípio de reuso: **não** recriar `messages`, `appointments`, `whatsapp_instances`,
`message_templates` nem seus helpers RLS. As migrations novas são **aditivas**.

### 5.0 Convenção de nomes das migrations
Continuar a sequência de timestamp. Sugestão (o design/planejador fixa os nomes exatos):
`20250223090000_messages_retry_fields.sql`, `20250223091000_webhook_events.sql`,
`20250223092000_pg_cron_setup.sql`, `20250223093000_lembrete_d1_job.sql`,
`20250223094000_retry_worker_job.sql`. Uma responsabilidade por migration (padrão do projeto).

### 5.1 Nova tabela: `webhook_events` (idempotência + auditoria de entrada)

**Por que uma tabela própria** (e não uma coluna em `messages`): o evento de entrada é um objeto
distinto de um disparo de saída — chega **antes** de sabermos a qual agendamento casa, pode não
casar nenhum, e precisa de uma chave de dedupe própria (id da mensagem da Evolution). Persistir o
evento recebido é o que garante a idempotência do webhook (defeito #1 do papel): se o mesmo
evento chegar de novo, a 2ª gravação viola o índice único e o processamento para antes de
qualquer efeito.

```sql
create table if not exists webhook_events (
  id                   uuid primary key default gen_random_uuid(),
  -- resolvido pela instância (whatsapp_instances), NUNCA do payload. Pode ser null se a
  -- instância não casar nenhum tenant (evento órfão) — ainda assim registrado p/ auditoria.
  tenant_id            uuid references tenants (id) on delete cascade,
  -- origem do evento; hoje só 'evolution'.
  source               text not null default 'evolution' check (source in ('evolution')),
  -- id da mensagem/evento da Evolution — CHAVE DE DEDUPE. Único por (source, external_event_id).
  external_event_id    text not null,
  -- nome da instância que recebeu (liga ao tenant); sem segredo.
  instance_name        text,
  -- 'recebido' | 'processado' | 'ignorado' | 'rejeitado' (autenticidade/schema) | 'erro'.
  status               text not null default 'recebido'
                       check (status in ('recebido','processado','ignorado','rejeitado','erro')),
  -- agendamento casado quando houver (FK composta por tenant, igual a messages).
  appointment_id       uuid,
  -- resultado interpretado: 'confirmar' | 'reagendar' | 'nao_reconhecido' | null.
  parsed_intent        text check (parsed_intent in ('confirmar','reagendar','nao_reconhecido')),
  -- metadados SEM PII: telefone NÃO em claro (hash ou omitido); sem texto cru da mensagem.
  payload              jsonb not null default '{}'::jsonb,
  failure_reason       text,
  created_at           timestamptz not null default now(),
  -- FK composta por tenant: evento só liga a agendamento do MESMO tenant (MATCH SIMPLE: só
  -- valida quando appointment_id não é nulo).
  constraint webhook_events_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments (tenant_id, id) on delete set null
);

-- DEDUPE real sob concorrência: o mesmo evento da Evolution só entra uma vez.
create unique index if not exists webhook_events_dedupe_uidx
  on webhook_events (source, external_event_id);
create index if not exists webhook_events_tenant_idx on webhook_events (tenant_id);
create index if not exists webhook_events_tenant_appointment_idx
  on webhook_events (tenant_id, appointment_id);
```

**RLS de `webhook_events`.** Habilitar RLS. Esta tabela é escrita **só** pela Edge Function de
webhook (service role, bypassa RLS) — nenhuma política de INSERT/UPDATE/DELETE para o cliente
(mesmo padrão de `messages`). Para leitura: é **log operacional de comunicação** (não financeiro),
então segue o padrão de `messages` — `admin`/`receptionist`/`professional` do tenant leem via
`tenant_id = current_tenant_id()` e `current_role_name() in (...)`. `super_admin` sem caminho pelo
cliente.

```sql
alter table webhook_events enable row level security;

drop policy if exists webhook_events_select_same_tenant on webhook_events;
create policy webhook_events_select_same_tenant on webhook_events for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );
-- Sem policy de INSERT/UPDATE/DELETE: gravação exclusiva da Edge Function (service role).
```

> **Alternativa considerada e descartada:** coluna `external_event_id` em `messages`. Descartada
> porque o evento de entrada frequentemente **não** gera uma linha de `messages` (resposta que
> não casa, evento duplicado, resposta `1` que só muda `appointments`), então pendurar dedupe de
> entrada em `messages` acopla dois ciclos de vida distintos e deixa buracos na idempotência.

### 5.2 Campos de retentativa em `messages` (migration aditiva — ALTER)

`messages` já tem `status in ('fila','enviado','entregue','falha')`, `dedupe_key`,
`failure_reason`, `provider_message_id`. Falta o estado de **retentativa**. Adicionar por ALTER
(migration nova — nunca editar a migration `20250220091000` já aplicada):

```sql
alter table messages
  add column if not exists attempts        int not null default 0,
  add column if not exists max_attempts     int not null default 5,
  add column if not exists next_attempt_at  timestamptz,       -- quando o worker pode reenviar
  add column if not exists last_attempt_at  timestamptz;

-- Índice para o worker varrer a fila elegível sem full scan:
create index if not exists messages_retry_due_idx
  on messages (status, next_attempt_at)
  where status = 'fila';
```

- `attempts` / `max_attempts` (N): limite de tentativas.
- `next_attempt_at`: agenda o próximo reenvio (backoff exponencial calculado pelo worker).
- **Janela útil:** o worker reusa o vínculo `appointment_id` → `appointments.starts_at`. Se
  `now() >= starts_at` para `template = 'lembrete_d1'`, marca `falha` (motivo `janela_vencida`),
  não tenta mais.

> O índice único parcial de idempotência de envio (`messages_dedupe_uidx` sobre `fila|enviado|
> entregue`) permanece válido — a retentativa atualiza a mesma linha `fila`, sem criar nova.

### 5.3 Enum `messages.template`: resposta automática de reagendamento

O `check` atual de `messages.template` é `('confirmacao','lembrete_d1','cobranca','comprovante')`.
A mensagem automática do RF-S2-06 ("entramos em contato para reagendar") precisa de uma chave.

**Decisão:** adicionar um novo valor de template, `reagendar_retorno`, ao `check` de
`messages.template` **e** a `message_templates` (nova chave de baseline/seed). Migration nova que:
(1) recria o `check` de `messages.template` incluindo `reagendar_retorno` (via
`drop constraint` + `add constraint`, idempotente); (2) estende `message_templates.template_key`
e as funções `seed_message_templates` / `handle_new_user` (via `create or replace`, preservando o
corpo) + backfill idempotente com o texto padrão pt-BR do novo template.

Texto padrão sugerido (pt-BR, sem PII, variáveis da lista fechada):
`'Oi {nome}, recebemos seu pedido de reagendar o {servico} na {empresa}. Nossa equipe entra em contato para marcar um novo horário.'`

> **Alternativa descartada:** reusar `confirmacao` para o retorno de reagendamento. Descartada
> porque polui a semântica do log e do dedupe, e o texto é diferente. Um template próprio mantém
> o render server-side e a idempotência coerentes.

### 5.4 pg_cron: disponibilidade e agendamento

**Disponibilidade.** `pg_cron` **não** está habilitado hoje (grep não encontrou referência; as
únicas extensões são `pgcrypto` e `btree_gist`). No Supabase hospedado, `pg_cron` roda no schema
`cron` e é habilitável por `create extension`. No ambiente **local** (CLI, Postgres 15 do
`config.toml`), `pg_cron` precisa estar na imagem; pode não estar disponível. **Decisão de
schema:** a migration de setup usa `create extension if not exists pg_cron;` e, para a chamada
HTTP à Edge Function, `create extension if not exists pg_net;` (ou `http`). O **design** decide o
mecanismo de invocação (pg_net POST para a Edge Function vs. função SQL local); este documento
exige apenas que:

- o agendamento seja **versionado em migration** (nunca criado só pela UI do Supabase);
- o cron chame uma **Edge Function com service role** (ou função `security definer`), nunca lógica
  no cliente;
- a granularidade seja a cada poucos minutos (p.ex. `*/5 * * * *`) tanto para o lembrete D-1
  quanto para o worker de retentativa (dois jobs distintos);
- se `pg_cron` não estiver disponível no ambiente local, a migration **não** pode quebrar o
  `db reset` — envolver o `cron.schedule` em bloco condicional (`do $$ ... if exists(select from
  pg_extension where extname='pg_cron') ...`) e **documentar** que o agendador real só é
  verificado em ambiente com a extensão; a lógica de seleção (a query SQL/função que lista
  elegíveis) é testada isoladamente.

**Isolamento por tenant no cron.** O job varre **todos** os tenants, mas cada linha candidata
carrega seu `tenant_id`; o disparo é por agendamento, e a resolução de instância/opt-in/janela é
por tenant. Nenhum `tenant_id` de parâmetro externo.

### 5.5 Resolução de tenant no webhook (sem JWT de usuário)

O webhook de entrada **não** tem JWT de usuário — a autenticidade é por token/assinatura do
provedor. O `tenant_id` é resolvido assim, no servidor, com service role:

1. A Evolution entrega o evento identificando a **instância** (`instance`/`instanceName` no
   payload). Validar com zod.
2. `select tenant_id from whatsapp_instances where evolution_instance_name = <instance>` →
   `tenant_id`. Se não casar, evento **órfão**: registrar em `webhook_events` com `tenant_id` null
   e `status = 'ignorado'`.
3. Todo o resto (busca de `customers` por telefone, agendamento, UPDATE) filtra por esse
   `tenant_id`. **Nunca** confiar em `tenant_id` do payload.

> Isto espelha a convenção da skill whatsapp-evolution: "resolver o tenant pela instância, nunca
> por parâmetro do cliente".

### 5.6 Autenticidade do webhook (Evolution v2.3.7)

A versão em uso (v2.3.7, confirmada no adapter) autentica chamadas de saída com header `apikey`.
Para o **webhook de entrada**, a Evolution não assina HMAC por padrão; o mecanismo prático e
recomendado é um **segredo compartilhado** que o Atlas controla:

- **Decisão:** exigir um token secreto na borda — ou um header fixo configurado na Evolution
  (`Authorization`/`apikey` custom) **ou** um segredo embutido no path/query da URL de webhook
  registrada na instância (ex.: `/whatsapp-inbound?token=<segredo>`), comparado em
  **tempo constante** contra `WHATSAPP_WEBHOOK_SECRET` do env. Sem match → `401`, registra
  `rejeitado`, nenhum efeito.
- O segredo vive **só** em env/secret do servidor (`supabase/functions/.env.example` ganha
  `WHATSAPP_WEBHOOK_SECRET=` e `EVOLUTION_WEBHOOK_*` conforme o design). Nunca `VITE_*`, nunca no
  bundle.
- O design **deve confirmar na doc da Evolution v2.3.7** o formato exato do payload de
  `messages.upsert`/webhook de entrada (campos `key.id`, `key.remoteJid`, `message.conversation`
  / `extendedTextMessage.text`, `instance`) e validar tudo com zod antes de usar.

### 5.7 Checklist de migration (por migration nova)

- [ ] `webhook_events`: `tenant_id` + índice + RLS habilitado + dedupe único
      `(source, external_event_id)`; sem policy de write p/ cliente.
- [ ] `messages` ALTER: campos de retentativa + índice da fila; não editar a migration original.
- [ ] enum `messages.template` + `message_templates` estendidos para `reagendar_retorno` (drop/add
      constraint idempotente; `create or replace` nas funções; backfill `on conflict do nothing`).
- [ ] pg_cron/pg_net via `create extension if not exists`; `cron.schedule` condicional p/ não
      quebrar `db reset` sem a extensão.
- [ ] Nenhum segredo no SQL. Dinheiro N/A nesta fatia; tempo em `timestamptz` UTC.
- [ ] Testado que usuário de outro tenant **não** lê `webhook_events`.

---

## 6. Critérios de aceite (testáveis, numerados)

1. **AC-01 (cron dispara D-1):** com um agendamento `pendente` de cliente `opt_in=true`, instância
   `conectado`, `starts_at` ~24h à frente e sem `lembrete_d1` prévio, a execução do job enfileira
   exatamente uma `messages` `template='lembrete_d1'`. (Testável chamando a função/SQL de
   elegibilidade sem o scheduler real.)
2. **AC-02 (cron idempotente):** executar o job duas vezes seguidas **não** cria um segundo
   `lembrete_d1` para o mesmo agendamento.
3. **AC-03 (sem opt-in não dispara):** agendamento de cliente `opt_in=false` **não** gera
   `lembrete_d1`.
4. **AC-04 (janela vencida):** agendamento com `starts_at` no passado **não** recebe D-1 (nem
   novo, nem retentativa).
5. **AC-05 (webhook autêntico):** POST sem o segredo correto retorna `401`, registra
   `webhook_events.status='rejeitado'` e **nenhum** agendamento muda.
6. **AC-06 (webhook schema inválido):** payload que falha o zod retorna `400`/registro
   `rejeitado`, sem efeito.
7. **AC-07 (resposta "1" confirma):** evento válido com texto `1` casado a um agendamento
   `pendente`/`confirmado` do tenant certo leva `appointments.status='confirmado'` e
   `confirmed_at` carimbado; `webhook_events.status='processado'`, `parsed_intent='confirmar'`.
8. **AC-08 (idempotência de entrada):** reenviar o **mesmo** evento (mesmo `external_event_id`)
   **não** gera segunda confirmação nem segundo efeito; a 2ª gravação em `webhook_events` é
   barrada pelo índice único e o processamento para antes do efeito.
9. **AC-09 (resposta "2" não altera):** evento com texto `2` casado a um agendamento **não** muda
   `appointments.status`; enfileira uma `messages` `template='reagendar_retorno'`;
   `webhook_events.parsed_intent='reagendar'`.
10. **AC-10 (não casa):** evento de um telefone sem agendamento elegível no tenant é registrado
    `ignorado` e não produz efeito nem erro ao provedor.
11. **AC-11 (isolamento no casamento):** um telefone que existe em dois tenants só casa com o
    agendamento do tenant **da instância** que recebeu; nunca confirma agendamento de outro
    tenant.
12. **AC-12 (transição inválida é segura):** resposta `1` para um agendamento já `cancelado`/
    `concluido` **não** derruba a função (erro do trigger tratado), registra o resultado e segue.
13. **AC-13 (retentativa com backoff):** uma `messages` em `fila` que falhou no envio é reenviada
    pelo worker respeitando `next_attempt_at`; `attempts` incrementa a cada tentativa.
14. **AC-14 (limite N):** após `attempts >= max_attempts` a mensagem vira `falha` com
    `failure_reason` e não é mais reenviada.
15. **AC-15 (retentativa respeita janela):** `lembrete_d1` em `fila` cujo agendamento já passou de
    `starts_at` é marcado `falha` (`janela_vencida`) e não reenviado.
16. **AC-16 (RLS webhook_events):** usuário autenticado do tenant A não lê `webhook_events` do
    tenant B; o cliente não consegue INSERT/UPDATE/DELETE em `webhook_events`.
17. **AC-17 (PII mínima):** `webhook_events.payload`, `messages.payload` e os logs não contêm
    telefone, documento nem o texto cru da mensagem em claro.
18. **AC-18 (sem segredo no cliente):** nenhum segredo de webhook/Evolution/service role aparece
    no bundle do frontend nem em arquivo versionado; só `.env.example` com chaves vazias.
19. **AC-19 (migrations versionadas):** todo schema/cron desta fatia está em migration nova; o
    `db reset` roda limpo (ou, sem pg_cron local, não quebra e documenta a limitação).
20. **AC-20 (build/typecheck):** `deno check` da(s) Edge Function(s) e o typecheck do projeto
    passam limpos; QA ao vivo do webhook com payload simulado cobre `1`, `2`, duplicado e
    inválido/não-autêntico.

---

## 7. Fora de escopo

- Botões/listas interativas da Evolution (resposta é **numérica**, texto livre).
- Reagendamento automático / mudança de horário por resposta `2` (decisão "c": só mensagem de
  retorno + tratamento manual).
- Autoagendamento público, métricas consolidadas, módulo Asaas/PIX (`cobranca`/`comprovante`
  seguem só sob demanda).
- Recorte de leitura de `messages`/`webhook_events` por profissional (fase futura).
- Múltiplas instâncias de WhatsApp por tenant.

---

## 8. Premissas e pontos para o design resolver

- **Premissa:** a Evolution v2.3.7 entrega o evento de entrada identificando a instância e o id da
  mensagem; o design confirma os campos exatos na doc e os valida com zod.
- **Premissa:** o segredo do webhook é um token compartilhado controlado pelo Atlas
  (`WHATSAPP_WEBHOOK_SECRET`), já que a Evolution não assina HMAC por padrão.
- **A decidir no design:** webhook como nova Edge Function (ex.: `whatsapp-inbound`) vs. nova rota
  na função `whatsapp` — o schema não depende disso; recomendação: **função separada** (superfície
  pública sem JWT, modelo de auth distinto do `send` autenticado por JWT).
- **A decidir no design:** mecanismo de invocação do cron (pg_net POST para a Edge Function vs.
  função SQL `security definer` que faz o trabalho) e os parâmetros de backoff (base, fator, N).
- **A decidir no design:** faixa exata da janela D-1 (ex.: 23h–25h) e granularidade do cron.
- **Nunca descartado:** todos os pontos do usuário (lembrete numérico via pg_cron; "responder 1
  marca confirmado"; resposta 2 = opção c; fila de retentativa) estão cobertos acima.
