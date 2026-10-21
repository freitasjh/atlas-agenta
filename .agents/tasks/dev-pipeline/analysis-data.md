# Análise de Dados e Segurança — WhatsApp Fase 2, Fatia 1: Templates de mensagem editáveis por tenant

Autor: Analisador de Dados e Segurança (dev-pipeline)
Projeto: atlas-agenda · base: `master` (default branch)
Escopo deste documento: requisitos verificáveis, critérios de aceite testáveis, modelo de dados + migrations e políticas RLS/RBAC. **Não** contém código de aplicação.

---

## 1. Resumo e valor de negócio

### 1.1 O que entra

Entregar o **CRUD de templates de mensagem WhatsApp por tenant**, com **variáveis**, consumido pelo **envio sob demanda já existente** (Edge Function `whatsapp`, operação `send`). Hoje o disparo manda **texto cru**: em `supabase/functions/whatsapp/index.ts`, `handleSend` chama `adapter.sendText({ ..., text: input.template })` — ou seja, envia a **string da chave do template** (`"confirmacao"`, `"lembrete_d1"`, …) como se fosse o corpo da mensagem. Esta fatia introduz o **texto real renderizado** a partir de um template pertencente ao tenant, com variáveis substituídas e fallback previsível.

Escopo concreto:
- Modelar e armazenar templates por tenant para as 4 chaves padrão: `confirmacao`, `lembrete_d1`, `cobranca`, `comprovante` — texto pt-BR com variáveis (`{nome}`, `{servico}`, `{dataHora}`, `{empresa}`, …).
- Tela de configuração em `/app/config/whatsapp` para o **admin** criar/editar o texto de cada template.
- Renderização das variáveis no momento do envio (no servidor, dentro da Edge Function).
- O disparo sob demanda passa a usar o **template renderizado do tenant** em vez do texto cru.

### 1.2 O que NÃO entra (Fatia 2, próximo run)

Confirmação interativa, webhook de entrada da Evolution, `pg_cron`/agendador, fila de retentativa, botões interativos. **Decisões já tomadas** para a Fatia 2 (não implementar agora, só deixar o contrato preparado): resposta por **opção numérica** (`1 confirmar`) e lembrete D-1 via **pg_cron** do Supabase. Nesta fatia isso se traduz apenas em: o texto do template `lembrete_d1` pode conter a instrução `1 confirmar / 2 reagendar` como **texto livre**, sem nenhuma lógica de parsing/webhook acoplada.

### 1.3 Valor de negócio

- **Reduzir no-show e padronizar a comunicação:** o tenant deixa de depender de um texto genérico/cru e passa a enviar mensagens personalizadas com o nome do cliente, serviço, data/hora e nome da empresa — o objetivo central do produto (régua de comunicação). É o degrau que torna o `lembrete_d1` útil e prepara a confirmação interativa da Fatia 2.
- **Autonomia do admin:** cada empresa edita seus próprios textos sem depender de deploy, dentro do que os planos permitem (produto.md: "mensagens personalizadas" é diferencial dos planos Clínica/Pro).
- **Segurança como requisito inegociável:** isolamento por tenant (RLS), nada de PII em log, nenhum segredo no cliente. Esta fatia introduz uma nova tabela de domínio — e, portanto, uma nova superfície onde vazamento entre tenants seria defeito grave.

### 1.4 Definição de defeito (do pedido do usuário — cada um vira critério de aceite)

1. Template **vazar entre tenants** (falha de RLS).
2. **Quebrar o envio sob demanda atual** (regressão do fluxo `send`).
3. Renderizar **variável não resolvida sem controle** (ex.: enviar `{nome}` cru ao cliente final).
4. **Expor segredo/PII em log** (telefone, texto com dado pessoal, token).

---

## 2. Enquadramento no roadmap

| Fase | Entregue | Esta fatia |
|---|---|---|
| Fase 1 (MVP) | Conexão por QR, envio **sob demanda** (ADR-04/06/07/08), log `messages`, idempotência por `dedupe_key`, opt-in LGPD | — |
| **WhatsApp Fase 2 — Fatia 1** | — | **Templates editáveis por tenant + renderização no envio sob demanda** ← este run |
| WhatsApp Fase 2 — Fatia 2 | — | Confirmação interativa numérica, webhook de entrada Evolution, pg_cron (lembrete D-1), fila de retentativa — **contrato preparado, não implementado** |
| Fase 3 | — | Link público de autoagendamento, taxa de reserva, métricas (fora de escopo) |

Reuso explícito (não recriar): a coluna `messages.template` **já existe** como enum (`confirmacao|lembrete_d1|cobranca|comprovante`); o conceito de "chave de template" já é usado. A infra privilegiada (Edge Function `whatsapp` com service role, resolução de `tenant_id`/`role` do JWT, opt-in, idempotência, checagem de instância conectada, normalização E.164) **permanece intacta** — esta fatia só troca a origem do `text` enviado ao adapter.

---

## 3. Requisitos funcionais (verificáveis)

**RF-T01 — Tabela de templates por tenant.** Existe `message_templates` com uma linha por `(tenant_id, template_key)` para as 4 chaves padrão. `template_key` restrito ao mesmo enum de `messages.template`.

**RF-T02 — Baseline/seed.** Ao criar um tenant novo, os 4 templates padrão em pt-BR são populados automaticamente (o tenant nunca começa sem templates). Para tenants já existentes, uma rotina de baseline idempotente garante as 4 linhas.

**RF-T03 — Leitura dos templates.** A tela de configuração lista os 4 templates do tenant com o texto atual. Papéis que podem **ler**: `admin`. (Decisão de RBAC em §7; recepção/profissional **não** editam e não precisam ler os templates para o envio, pois a renderização é server-side.)

**RF-T04 — Edição pelo admin.** O admin edita o `body` (texto pt-BR) de cada template via tela (`react-hook-form` + `zod`, TanStack Query, mobile-first). A edição persiste em `message_templates` sob RLS do tenant.

**RF-T05 — Conjunto fechado de variáveis.** O corpo suporta um conjunto **fechado e documentado** de variáveis: `{nome}`, `{servico}`, `{dataHora}`, `{empresa}`. Variáveis fora da lista são tratadas como texto literal (não quebram o envio) — ver §6.

**RF-T06 — Renderização no envio (server-side).** No `handleSend`, o `text` enviado ao adapter passa a ser o **body do template do tenant renderizado** (variáveis substituídas), nunca a string crua da chave. A renderização ocorre **no servidor** (Edge Function), com os dados resolvidos sob service role dentro do tenant.

**RF-T07 — Fallback previsível.** Quando um dado de variável faltar (ex.: cliente sem nome, agendamento ausente), a variável é substituída por um fallback pt-BR definido (§6.3) — **nunca** se envia o placeholder cru (`{nome}`) ao cliente final.

**RF-T08 — Preservar o envio atual.** Todos os caminhos atuais de `send` (opt-out, duplicate, not_connected, send_failed, sent) continuam funcionando com os mesmos `outcome`/status HTTP. O contrato de fio de `send` (payload `action|template|customerId|appointmentId?`) **não muda**.

**RF-T09 — Contrato preparado para a Fatia 2 (sem implementar).** O texto do template `lembrete_d1` aceita a instrução numérica `1 confirmar / 2 reagendar` como texto livre. Nenhuma lógica de webhook/parsing/cron é adicionada. A modelagem de `message_templates` não impede evoluir para variações por canal/opção numérica depois.

---

## 4. Requisitos não-funcionais

**RNF-T01 — Isolamento multi-tenant (inegociável, RNF03).** `message_templates` tem `tenant_id not null` + índice + RLS habilitado. `tenant_id` deriva do JWT/`profiles` (`current_tenant_id()`), **nunca** de parâmetro do cliente. Um usuário do tenant A nunca lê/edita template do tenant B.

**RNF-T02 — Segredos e PII em log.** A renderização e o envio não logam telefone nem o texto renderizado em claro (mantém a invariante de `messages`: `payload` sem PII, `failure_reason` técnico curto). Token/URL da Evolution continuam só em env do servidor. O body do template **não** é segredo (é conteúdo do tenant), mas o **texto renderizado** (que contém o nome do cliente) **não** vai para log em claro.

**RNF-T03 — TS estrito + validação zod.** Novos tipos tipados (sem `any`). O body do template e o payload de edição são validados com zod no cliente (UX) e o shape lido do banco é validado antes do uso. A lista de variáveis é um enum fechado.

**RNF-T04 — Migration versionada.** Toda mudança de schema é uma migration nova em `supabase/migrations`, nunca editando migration já aplicada. Idempotente no re-apply (`create table if not exists` / `drop policy if exists`).

**RNF-T05 — Determinismo da renderização.** A função de render é pura e determinística dado (template, dados resolvidos): mesma entrada → mesma saída, sem relógio/rede além da resolução de dados do tenant.

---

## 5. Critérios de aceite (testáveis e numerados)

**AC-01 (RF-T01/RNF-T04).** Aplicada a migration, `message_templates` existe com colunas de §8, `unique (tenant_id, template_key)`, índice em `tenant_id`, RLS habilitado. `supabase db reset`/`supabase start` aplica sem erro.

**AC-02 (RF-T02).** Após `handle_new_user` (cadastro de empresa nova), o novo tenant tem exatamente 4 linhas em `message_templates` (uma por chave), com textos padrão pt-BR não vazios. Reexecutar a baseline em tenant que já tem as 4 linhas **não** duplica (idempotência).

**AC-03 (RNF-T01 — isolamento, cobre defeito #1).** Com dois tenants A e B: um usuário autenticado do tenant A executa `select * from message_templates` e vê **somente** as linhas de A; tentativa de `update` de uma linha de B é negada por RLS. Teste comprovado via sessão autenticada (anon key + JWT), não service role.

**AC-04 (RF-T03/RF-T04 — RBAC).** Admin consegue `select` e `update` os templates do seu tenant. Um usuário `receptionist`/`professional` **não** consegue `update` (negado por RLS). (Leitura: ver decisão §7 — por padrão só admin lê.)

**AC-05 (RF-T06 — renderização no envio, cobre defeito #2).** Admin edita o template `confirmacao` para `"Olá {nome}, seu horário de {servico} é {dataHora}."`. Dispara "Enviar mensagem" para um cliente com opt-in. O `text` entregue ao adapter é o **texto renderizado** com `{nome}/{servico}/{dataHora}` substituídos pelos dados reais — **não** a string `"confirmacao"`. Verificado ao vivo (mock loga/retorna o que recebeu) e/ou em teste da função de render.

**AC-06 (RF-T07 — fallback, cobre defeito #3).** Disparo de um template com `{nome}` para um cliente/caso em que o dado falta → o texto enviado contém o **fallback pt-BR** (ex.: "você"/"cliente"), nunca a string literal `{nome}`. Variável fora da lista fechada (ex.: `{foo}`) é mantida como texto literal e não quebra o envio.

**AC-07 (RF-T08 — sem regressão).** Os 5 `outcome` de `send` (`sent|duplicate|opt_out|not_connected|send_failed`) continuam produzidos nas mesmas condições e com os mesmos status HTTP após a mudança. Opt-in, idempotência (`dedupe_key`) e checagem de instância conectada permanecem antes do envio.

**AC-08 (RNF-T02 — PII/segredo, cobre defeito #4).** Nenhum log da Edge Function imprime telefone do cliente nem o texto renderizado em claro; `messages.payload` continua sem PII; nenhum segredo da Evolution aparece em log/resposta/bundle. `grep` por `VITE_` não encontra chave da Evolution.

**AC-09 (RF-T09 — contrato Fatia 2).** O body do `lembrete_d1` aceita e renderiza texto com `1 confirmar / 2 reagendar` sem erro; nenhum endpoint de webhook/entrada nem job de cron é adicionado neste run (verificável por ausência de arquivos/migrations correspondentes).

**AC-10 (build/typecheck + QA ao vivo).** `npm run build` / typecheck limpos. QA ao vivo (chrome-devtools) em `/app/config/whatsapp`: admin edita um template, dispara "Enviar mensagem" (Agenda/Clientes) e confirma que o texto enviado é o renderizado.

---

## 6. Modelo de variáveis (lista fechada + fallback)

### 6.1 Lista fechada suportada (Fatia 1)

| Variável | Origem (resolvida no servidor, dentro do tenant) | Observação |
|---|---|---|
| `{nome}` | `customers.name` | nome do cliente final |
| `{servico}` | `services.name` via `appointments.service_id` | só quando há `appointmentId` |
| `{dataHora}` | `appointments.starts_at` formatado no **timezone do tenant** (`tenants.timezone`, default `America/Sao_Paulo`) | armazenado em UTC, exibido no fuso do tenant (dominio.md) |
| `{empresa}` | `tenants.trade_name` (fallback `legal_name`) | nome fantasia da empresa |

Recomendação: **lista fechada** travada em um enum/const compartilhado. Variável desconhecida no texto (`{foo}`) **não** é substituída e permanece literal — não quebra o envio e não vaza erro ao cliente. Isso evita que o admin "invente" uma variável e receba um placeholder cru enviado ao cliente.

### 6.2 Onde a renderização acontece

**Decisão: renderização 100% no servidor (Edge Function `whatsapp`, dentro de `handleSend`).** Alternativa considerada — renderizar no cliente e enviar o texto pronto — é **rejeitada**: o cliente não deve resolver dados do tenant para montar o corpo (abriria espaço para o front forjar texto/burlar o log, e o servidor é a fronteira única de envio, ADR-04). O servidor já resolve `customer` sob service role; passa a resolver também `service`/`appointment`/`tenant.trade_name`/`tenant.timezone` e o `body` do template, renderiza e envia. Mantém a invariante "o envio é um ponto privilegiado único e testável".

Fluxo dentro de `handleSend` (após as travas atuais — opt-in, idempotência, instância conectada):
1. Carregar o `body` do template `message_templates` por `(tenant_id, template_key = input.template)`. Se não houver linha (tenant legado sem baseline), aplicar o **texto padrão de sistema** da chave (fallback de template — §6.4) para nunca enviar vazio nem a chave crua.
2. Resolver as variáveis necessárias (customer já resolvido; service/appointment/tenant conforme as variáveis presentes no texto).
3. Renderizar (substituição das variáveis da lista fechada, com fallback por variável faltante).
4. `adapter.sendText({ ..., text: <renderizado> })`.

### 6.3 Fallback por variável faltante (comportamento previsível)

| Variável | Fallback pt-BR quando o dado falta |
|---|---|
| `{nome}` | `cliente` |
| `{servico}` | `seu atendimento` |
| `{dataHora}` | `no horário combinado` |
| `{empresa}` | `nossa equipe` |

Regra invariável (cobre defeito #3): **nunca** renderizar o placeholder cru (`{nome}`) para o cliente final. Se faltar dado, usa o fallback; se a variável for desconhecida, mantém literal (decisão consciente — só as 4 variáveis conhecidas têm fallback).

### 6.4 Fallback de template ausente

Se o tenant não tiver a linha do template (ex.: tenant criado antes da baseline), o servidor usa o **texto de sistema padrão** daquela chave (constante no servidor) — garante que o envio nunca mande a string crua da chave nem texto vazio. A baseline (§4/RF-T02) deve zerar esse caso para tenants existentes.

---

## 7. RBAC — quem lê e quem edita templates

Fronteira do projeto (seguranca-multitenant.md): `admin` = tudo no tenant; `professional` = só a própria agenda; `receptionist` = agendamentos sem dados financeiros.

Template de mensagem **não** é dado financeiro, mas é **configuração do tenant** (como serviços, horários, conexão de WhatsApp). O padrão do projeto para configuração é "só admin edita" (ex.: `whatsapp_instances_write_admin`, `tenants_update_own_admin`).

**Decisão recomendada:**
- **Edição (`insert`/`update`/`delete`): somente `admin`.** Espelha `whatsapp_instances` e `tenants` (configuração do dono). Alinha com o pedido ("RBAC admin edita").
- **Leitura (`select`): somente `admin`.** Justificativa: a renderização é server-side (service role), então recepção/profissional **não precisam** ler `message_templates` para disparar — o envio funciona sem que esses papéis vejam/editem o texto. Restringir a leitura ao admin reduz a superfície e mantém a configuração como assunto do dono do tenant. Isto **não** quebra o envio sob demanda (que continua disponível a admin/receptionist/professional via `canSendWhatsAppMessage`), porque quem lê o template no envio é a Edge Function com service role, não o cliente.

Consequência de UI: a tela de edição de templates fica sob guard de `admin` (novo permission flag, ex.: `canManageWhatsAppTemplates = isAdmin`), coerente com `canManageWhatsAppConnection`. `super_admin` **sem** caminho cross-tenant pelo cliente a esta tabela (coerente com as demais tabelas de domínio).

---

## 8. Modelo de dados

### 8.1 Decisão: tabela própria `message_templates` (não "defaults de sistema + override difuso")

Duas abordagens consideradas:

- **(A) Tabela `message_templates` por tenant com uma linha por `(tenant_id, template_key)`**, semeada com os 4 padrões no cadastro. ✅ **Escolhida.**
- (B) Defaults de sistema em código + tabela de override só quando o tenant customiza. ❌ Rejeitada: cria dois caminhos de leitura (código vs. banco), complica a tela (estado "herdado" vs "customizado") e dificulta a evolução (planos que permitem/limitam customização, histórico). A simplicidade de "sempre há 4 linhas por tenant" vence, e o fallback de template ausente (§6.4) cobre o tenant legado até a baseline rodar.

A convenção do projeto (tabelas com `tenant_id not null default current_tenant_id()` + RLS) favorece (A) e reusa todo o padrão já estabelecido em `whatsapp_instances`/`messages`.

### 8.2 Tabela `message_templates`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `tenant_id` | `uuid` | `not null default current_tenant_id()`, FK `tenants(id) on delete cascade`, indexado |
| `template_key` | `text` | `not null`, `check (template_key in ('confirmacao','lembrete_d1','cobranca','comprovante'))` — espelha `messages.template` |
| `body` | `text` | `not null`, `check (char_length(body) between 1 and 2000)` — texto pt-BR com variáveis |
| `active` | `boolean` | `not null default true` — permite desativar um template sem apagar (reservado; Fatia 1 mantém sempre `true`) |
| `updated_at` | `timestamptz` | `not null default now()` (UTC) |
| `created_at` | `timestamptz` | `not null default now()` (UTC) |

Restrições/índices:
- `unique (tenant_id, template_key)` — uma linha por chave por tenant (trava no banco, não só na UI).
- `create index message_templates_tenant_id_idx on message_templates (tenant_id)`.

Notas de convenção: inglês/snake_case/plural; sem dinheiro; tempo em `timestamptz` UTC; nenhum segredo no SQL. **Sem** coluna de telefone/PII (o template é texto com placeholders, não dado pessoal).

> Observação sobre o contrato da Fatia 2: `template_key` como enum de 4 chaves é suficiente agora. Se a confirmação interativa exigir variações (ex.: versão com opções numéricas), isso será uma mudança **aditiva** futura (coluna/variante nova), não uma quebra — a modelagem atual não impede.

### 8.3 Migrations (SQL versionado — não editar migrations aplicadas)

Duas migrations novas em `supabase/migrations`, com timestamp posterior à última aplicada (`20250221091000_schedule_overrides.sql`):

**Migration 1 — `<timestamp>_message_templates.sql`** (esboço de schema, não é código de app):

```sql
-- message_templates — texto editável por tenant da régua de comunicação (WhatsApp Fase 2 Fatia 1).
-- Isolamento multi-tenant (RNF03): tenant_id default current_tenant_id() (deriva do JWT/profiles,
-- NUNCA do cliente), índice por tenant, RLS habilitado. Helpers current_tenant_id()/
-- current_role_name() (security definer) reutilizados — NÃO recriados.
-- RBAC: só admin lê e edita (configuração do dono do tenant, espelha whatsapp_instances/tenants).
-- A renderização do envio é server-side (service role, Edge Function) — recepção/profissional
-- não precisam ler esta tabela para disparar.

create table if not exists message_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  template_key text not null
               check (template_key in ('confirmacao','lembrete_d1','cobranca','comprovante')),
  body         text not null check (char_length(body) between 1 and 2000),
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint message_templates_tenant_key_unique unique (tenant_id, template_key)
);

create index if not exists message_templates_tenant_id_idx on message_templates (tenant_id);

alter table message_templates enable row level security;

-- SELECT: só admin do tenant (configuração do dono). super_admin sem caminho pelo cliente.
drop policy if exists message_templates_select_admin on message_templates;
create policy message_templates_select_admin on message_templates for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- WRITE (insert/update/delete): só admin do tenant. WITH CHECK espelha o USING para barrar
-- gravar linha de outro tenant (com o default, o INSERT do cliente — sem tenant_id — recebe o
-- tenant do JWT e passa; cross-tenant barrado). A baseline roda via service role (bypassa RLS).
drop policy if exists message_templates_write_admin on message_templates;
create policy message_templates_write_admin on message_templates for all
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin')
  with check (tenant_id = current_tenant_id() and current_role_name() = 'admin');
```

**Migration 2 — `<timestamp>_message_templates_baseline.sql`** (seed/baseline, RF-T02/AC-02):

Responsabilidades:
1. Uma função `security definer` `seed_message_templates(tenant_id)` que insere as 4 chaves com textos padrão pt-BR, `on conflict (tenant_id, template_key) do nothing` (idempotente). Roda fora do RLS, como as demais funções de signup.
2. Backfill idempotente para tenants existentes: `insert ... select` cruzando `tenants` com as 4 chaves, `on conflict do nothing`.
3. Acoplar a baseline ao cadastro de empresa: estender `handle_new_user()` (ou chamar `seed_message_templates(v_tenant_id)` a partir dele) para popular os 4 templates no mesmo fluxo atômico do signup. **Reusar o padrão** da migration `20250216092000_signup_trigger.sql`; esta migration 2 **recria** `handle_new_user` com `create or replace` (nunca editando a migration antiga).

Textos padrão pt-BR (esboço — o planejamento/implementação fixa a redação final; manter `{nome}/{servico}/{dataHora}/{empresa}` e, no `lembrete_d1`, o `1 confirmar / 2 reagendar` como texto livre):

```
confirmacao:  "Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}."
lembrete_d1:  "Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar."
cobranca:     "Olá {nome}, segue a cobrança do seu {servico} na {empresa}."
comprovante:  "Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!"
```

> `cobranca`/`comprovante` referem valores/PIX; a Fatia 1 só renderiza as 4 variáveis da lista fechada. Variáveis de valor (ex.: `{valor}`) são fora de escopo desta fatia (dependem do módulo Asaas/cobranças) — ficam como evolução aditiva futura, não bloqueiam este run.

### 8.4 Impacto na Edge Function (contrato de dados — não é código aqui)

- `handleSend` passa a, após as travas atuais, **ler o `body`** de `message_templates` por `(tenant_id, template.input)` (service role, dentro do tenant já resolvido), **resolver** as variáveis e **renderizar**, enviando o texto ao adapter.
- Resolução adicional sob service role: `services.name` (via `appointments.service_id` quando `appointmentId` presente), `appointments.starts_at`, `tenants.trade_name` + `tenants.timezone`. Tudo filtrado por `tenant_id` derivado do JWT.
- `messages.payload` continua sem PII: pode registrar `template_key` e metadados não sensíveis, **nunca** o texto renderizado com o nome do cliente nem o telefone.
- O contrato de fio de `send` (payload e `SendResponse`) **não muda** — logo, os schemas zod do frontend e os DTOs em `src/lib/whatsapp.ts` não precisam alterar por causa do envio (a mudança de UI é a nova tela de templates, não o diálogo de envio).

---

## 9. Riscos e invariantes de segurança (checklist de fronteira)

- [ ] **RLS em `message_templates`** habilitado; `tenant_id` do JWT, nunca do cliente (RNF-T01, AC-03). Barrar cross-tenant comprovado com sessão autenticada.
- [ ] **WITH CHECK** presente nas policies de escrita (evita inserir linha de outro tenant).
- [ ] **Recursão de RLS** evitada: reusar `current_tenant_id()`/`current_role_name()` (security definer), não reimplementar.
- [ ] **Renderização server-side**; o cliente nunca monta o texto final (fecha a porta a forjar corpo/burlar log).
- [ ] **PII/segredo em log:** sem telefone/texto renderizado em claro; token Evolution só em env; nenhuma var `VITE_` com segredo (RNF-T02, AC-08).
- [ ] **Fallback previsível:** nunca enviar `{nome}` cru; lista de variáveis fechada (RF-T05/RF-T07, AC-06).
- [ ] **Sem regressão do `send`:** opt-in, idempotência (`dedupe_key`), instância conectada preservados; 5 outcomes intactos (AC-07).
- [ ] **Migration nova e idempotente;** nenhuma migration aplicada é editada (RNF-T04).
- [ ] **Baseline idempotente;** novo tenant nasce com 4 templates; tenant legado backfilled sem duplicar (RF-T02, AC-02).
- [ ] **Fatia 2 não antecipada:** nenhum webhook/cron/parsing adicionado; só o contrato preparado (AC-09).

---

## 10. Testabilidade

- **Unit (render):** a função de renderização (template + dados → texto) é pura e determinística — testável isolada: substituição correta, fallback por variável faltante, variável desconhecida mantida literal, template ausente cai no padrão de sistema (RNF-T05, AC-05/AC-06).
- **Integração (RLS):** testar com duas sessões autenticadas (dois tenants) que A não lê/edita template de B e que receptionist/professional não editam (AC-03/AC-04). Testar via anon key + JWT, não service role.
- **Integração (envio):** com o adapter mock, verificar que `sendText` recebe o texto renderizado e que os 5 outcomes continuam corretos (AC-05/AC-07).
- **Migration/baseline:** `supabase db reset` aplica as duas migrations; cadastro de empresa nova gera 4 templates; backfill não duplica (AC-01/AC-02).
- **Build/QA:** `npm run build`/typecheck limpos; QA ao vivo em `/app/config/whatsapp` (AC-10). Ambiente: `supabase start`; `supabase functions serve whatsapp --env-file supabase/functions/.env`; `npm run dev`.

---

## 11. Fora de escopo (reafirmado)

Confirmação interativa, webhook de entrada da Evolution, pg_cron/agendador, fila de retentativa, botões interativos, variáveis de valor/PIX (`{valor}`), customização por plano, histórico/versionamento de templates. Tudo isso é Fatia 2+ ou fase futura — não implementar neste run; apenas não fechar a porta para a evolução aditiva.
