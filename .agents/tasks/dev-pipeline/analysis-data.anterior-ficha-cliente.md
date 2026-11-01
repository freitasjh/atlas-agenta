# Análise de Dados e Segurança — Ficha do cliente (Fase 1b / CLÍNICA)

Subagente analisador de dados e segurança do `dev-pipeline`. Esta análise substitui o conteúdo
anterior deste arquivo (bugfix de gating em `CombosPage`, já mergeado no PR #15).

Demanda: primeiro recurso de domínio do ramo clínica: ficha do cliente com informações clínicas
básicas, observações e histórico, registrada pelo profissional durante ou após o atendimento.
**Dado de saúde (LGPD art. 5º, II, dado sensível).** O usuário está ciente e optou por seguir.

Skills ativadas: `supabase-multitenant` (fronteiras, RLS, migrations), `agenda-scheduling` (estados
do agendamento, `em_atendimento`/`concluido`). `asaas-pix` e `whatsapp-evolution` não foram
ativadas como fonte de implementação, porque a demanda não cria cobrança nem disparo. Mesmo assim,
as restrições delas valem aqui (ver §5.4). Steering lido: `produto.md`, `dominio.md`, `stack.md`,
`seguranca-multitenant.md`, `convencoes-codigo.md`. Brain consultado (`project: atlas-agenda`):
nenhuma nota específica de ficha clínica. Lido também o código de referência do origin.

---

## 0. Veredito

A demanda **toca dados sensíveis e segurança**: nova tabela de domínio, RLS por papel, dado de saúde,
migrations novas. Pontos principais:

1. A ficha é **append-only**, com correções como novos registros ligados ao registro anterior.
2. **Recepção não lê nem escreve** nada da ficha. Profissional só acessa os atendimentos que são
   dele. Admin acessa tudo do tenant.
3. `segment` **não entra no RLS**. O gating `clinica` é só de UI, na própria rota, e o RLS por
   `tenant_id` continua sendo a fronteira real.
4. Nenhum conteúdo clínico em log, em payload de listagem, em mensagem WhatsApp, em erro ou em
   payload enviado a Evolution ou Asaas.
5. Há um item do pedido original que **precisa de decisão antes de implementar**: a base demo com
   senha `demo` (§9). Ela é de alto risco se rodar contra um projeto Supabase real.

---

## 1. Enquadramento no roadmap e base do trabalho

- Fase 1a (personalização por segmento): MERGED.
- Fase 1b / barbearia (comissão): MERGED (PR #14).
- Fase 1b / salão (combos/pacotes): MERGED (PR #15, `origin/master` em `4fb5598`).
- **Fase 1b / clínica (esta demanda):** primeiro recurso de domínio clínico. Não está listado entre
  os itens de Fase 3 de `produto.md`, então é extensão da Fase 1b aprovada pelo usuário.

**Ponto de atenção sobre a base de código.** A `master` local está em `8d6bab7` (atrás). O
`origin/master` já tem o PR #15. A branch atual do workspace é `feat/combos-pacotes-salao`, com
alterações não commitadas que não são deste trabalho. **A branch da clínica deve nascer de
`origin/master`**, não da branch de combos. Assim as migrations de salão (`…094000`, `…095000`,
`…096000`) entram no histórico como base. A análise não alterou branch nem working tree.

Timestamps livres: a última migration aplicada é `20250226096000_appointments_combo.sql`. As novas
começam em `20250227090000`.

---

## 2. Classificação da demanda

| Dimensão | Toca? | Observação |
|---|:-:|---|
| Tabela nova | ✅ | `clinical_records` (ficha append-only). |
| Alteração aditiva em tabela existente | ✅ | `appointments`: unique `(tenant_id, id, customer_id)` (§4.4). Só adiciona constraint. |
| Migration nova | ✅ | 2 migrations (§4.6). Nenhuma migration aplicada é editada. |
| RLS | ✅ | Policies novas por papel na tabela nova. Nenhuma policy existente alterada. |
| Trigger de imutabilidade | ✅ | Bloqueia UPDATE/DELETE/TRUNCATE na ficha, inclusive para service role. |
| Edge Function / RPC | ❌ | Não previstas. Leitura e escrita via PostgREST com RLS, anon key e sessão. |
| Segredo novo | ❌ | Nada novo no bundle. |
| Integração externa (Evolution, Asaas) | ❌ | Proibido enviar conteúdo clínico (§5.4). |
| Gating por segmento | ✅ | UI-only, na rota (`clinicalRecord` em `resolveFeatures`). |
| Demo por segmento (seed) | ✅ | Pedido original. Script de desenvolvimento, não migration (§9). |

---

## 3. Requisitos de negócio e de produto

- **Valor:** o profissional registra o que importa para a continuidade do cuidado (alergias,
  medicamentos em uso, observações do atendimento) e consulta o histórico do cliente sem depender de
  papel ou planilha.
- **Confiança:** a ficha não pode ser alterada em silêncio. Correções aparecem como registro novo,
  com a versão anterior preservada.
- **Segregação:** recepção organiza a agenda sem ver dado clínico. Esse é o mesmo princípio já
  aplicado a dado financeiro (`charges`, `appointment_commissions`).
- **Ramo:** tenants de barbearia, salão e legado não mudam de comportamento. A ficha só aparece para
  `segment='clinica'`.

---

## 4. Modelo de dados e migrations

### 4.1 Campos básicos (proposta de minimização, a confirmar)

Os três campos abaixo são o conjunto mínimo de "informações clínicas básicas e observações". Nenhum
documento, CPF, convênio ou dado extra entra na ficha, por minimização (LGPD art. 6º, III).

| Campo | Tipo | Limite | Obrigatório | Motivo |
|---|---|---|:-:|---|
| `allergies` | text | 500 caracteres | não | Alergias conhecidas. Relevante para segurança do procedimento. |
| `medications` | text | 500 caracteres | não | Medicamentos em uso contínuo. |
| `clinical_notes` | text | 2000 caracteres | não | Observações do atendimento. |

Regra: pelo menos um dos três, depois de `btrim`, precisa ter conteúdo. Não existe registro vazio.
Campos vazios são gravados como `null`, nunca como string vazia.

### 4.2 Tabela `clinical_records`

Uma linha por registro. Cada atendimento tem **um registro original**. Correções são novas linhas
que apontam para o registro corrigido.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()`. |
| `tenant_id` | uuid not null | `default current_tenant_id()`, FK para `tenants`. Nunca vem do cliente. |
| `customer_id` | uuid not null | FK composta `(tenant_id, customer_id)` → `customers`. |
| `appointment_id` | uuid not null | FK composta `(tenant_id, appointment_id, customer_id)` → `appointments` (§4.4). Garante que o cliente da ficha é o do atendimento. |
| `supersedes_id` | uuid null | `null` = original. Preenchido = correção de outro registro. FK composta `(tenant_id, supersedes_id, appointment_id, customer_id)` → `clinical_records`. |
| `allergies` | text null | `check (null or char_length(btrim) between 1 and 500)`. |
| `medications` | text null | Idem, limite 500. |
| `clinical_notes` | text null | Idem, limite 2000. |
| `created_by` | uuid not null | `default auth.uid()`. Autor do registro, para rastreio. Não é PII em texto. |
| `created_at` | timestamptz not null | `default now()`, UTC. |

Constraints e índices:

- `check` de conteúdo mínimo (§4.1).
- `unique (tenant_id, id, appointment_id, customer_id)`: alvo da FK de correção. **Declarar antes
  das FKs que o referenciam**, ou via `ALTER TABLE`.
- Índice único parcial: `(tenant_id, appointment_id) where supersedes_id is null`. Um original por
  atendimento.
- Índice único parcial: `(tenant_id, supersedes_id) where supersedes_id is not null`. Uma correção
  por registro. Isso impede bifurcação. A cadeia é linear.
- Índice `(tenant_id, customer_id, created_at)` para o histórico.
- Todas as FKs são `on delete restrict`. Ficha nunca some em cascata silenciosa.

### 4.3 Append-only (sem UPDATE/DELETE)

Três camadas, para que a imutabilidade não dependa de só uma:

1. **Sem policy de UPDATE/DELETE** na tabela. Com RLS ligado, a operação não encontra linhas e
   não tem efeito.
2. **`revoke update, delete, truncate on clinical_records from anon, authenticated`**. Remove o
   grant padrão do Supabase.
3. **Trigger `before update or delete` (por linha) e `before truncate` (por statement)** que
   levanta exceção com `errcode = 'restrict_violation'`. Vale para qualquer role, inclusive service
   role. A mensagem da exceção é fixa, sem eco de valores de coluna.

Correção = `insert` com `supersedes_id` apontando para o registro vigente. Na UI, "vigente" é o
registro sem sucessor. O histórico mostra a cadeia inteira.

### 4.4 Alteração aditiva em `appointments` (nova migration)

A FK composta `(tenant_id, appointment_id, customer_id)` exige um alvo único. Hoje `appointments`
tem apenas `unique (tenant_id, id)`. Adicionar `unique (tenant_id, id, customer_id)` é uma
alteração aditiva e segura: como `id` já é único, a nova constraint não pode falhar com dado
existente. Idempotente, no mesmo padrão de `20250220089000_appointments_tenant_unique.sql`
(bloco `do $$ … if not exists (pg_constraint)`).

Vantagem: o banco impede ficha de cliente A ligada a atendimento do cliente B, mesmo que a app erre.

### 4.5 Estado do atendimento permitido para registrar

"Durante ou após o atendimento concluído" vira regra de banco:

- Registro permitido apenas quando `appointments.status in ('em_atendimento','concluido')`.
- `pendente`, `confirmado`, `cancelado` e `nao_compareceu` não aceitam ficha.
- Vale para original e para correção (a correção também depende do atendimento estar no estado
  permitido).

Interpretação adotada: "durante" = `em_atendimento`; "após" = `concluido`. Se o usuário quiser só
`concluido`, basta mudar uma lista na policy.

### 4.6 Migrations (ordem obrigatória)

1. `supabase/migrations/20250227090000_appointments_customer_unique.sql`: unique aditivo em
   `appointments` (§4.4).
2. `supabase/migrations/20250227091000_clinical_records.sql`: tabela, constraints, índices, `enable
   row level security`, policies (§4.7), `revoke` de grants, função e triggers de imutabilidade.

Ambas idempotentes: `create table/index if not exists`, `drop policy if exists` antes de cada
`create policy`, `create or replace function`, `drop trigger if exists` antes de cada `create
trigger`. `supabase db reset` precisa terminar com exit 0. Nenhuma migration existente é editada.
Nenhum segredo no SQL.

Nenhuma migration altera `tenants.segment`, o enum ou o check de segmento. O gating é só de app.

### 4.7 Esboço do DDL (contrato de dados, não código de aplicação)

```sql
-- 20250227091000_clinical_records.sql (esboço)
create table if not exists clinical_records (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default current_tenant_id()
                   references tenants (id) on delete cascade,
  customer_id    uuid not null,
  appointment_id uuid not null,
  supersedes_id  uuid,                                   -- null = original
  allergies      text check (allergies is null or char_length(btrim(allergies)) between 1 and 500),
  medications    text check (medications is null or char_length(btrim(medications)) between 1 and 500),
  clinical_notes text check (clinical_notes is null or char_length(btrim(clinical_notes)) between 1 and 2000),
  created_by     uuid not null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint clinical_records_has_content check (
       nullif(btrim(allergies), '') is not null
    or nullif(btrim(medications), '') is not null
    or nullif(btrim(clinical_notes), '') is not null),
  constraint clinical_records_tenant_id_unique
    unique (tenant_id, id, appointment_id, customer_id),
  constraint clinical_records_customer_fk
    foreign key (tenant_id, customer_id) references customers (tenant_id, id) on delete restrict,
  constraint clinical_records_appointment_fk
    foreign key (tenant_id, appointment_id, customer_id)
    references appointments (tenant_id, id, customer_id) on delete restrict,
  constraint clinical_records_supersedes_fk
    foreign key (tenant_id, supersedes_id, appointment_id, customer_id)
    references clinical_records (tenant_id, id, appointment_id, customer_id) on delete restrict
);
-- Pelo MATCH SIMPLE padrão, a FK de correção não é checada quando supersedes_id é null.
```

### 4.8 Políticas RLS (esboço de intenção)

Função auxiliar de vínculo, sem `security definer` (reusa `appointments` e `professionals` sob o
RLS do próprio chamador). Duas formas do mesmo predicado:

- **Profissional é dono do atendimento:** existe `appointments a` com `a.id = appointment_id`, e
  `professionals p` com `p.id = a.professional_id`, `p.profile_id = auth.uid()`,
  `p.tenant_id = current_tenant_id()`.

Policies:

- **SELECT:** `tenant_id = current_tenant_id()` e (`current_role_name() = 'admin'` ou
  (`current_role_name() = 'professional'` e vínculo de dono do atendimento)). Recepção não tem caminho
  nenhum, nem leitura.
- **INSERT (WITH CHECK):** `tenant_id = current_tenant_id()` e `created_by = auth.uid()` e (admin ou
  profissional dono do atendimento) e atendimento com `status in ('em_atendimento','concluido')` e
  tenant com `subscription_status not in ('bloqueado','cancelado')`.
- **UPDATE e DELETE:** nenhuma policy (ver §4.3).
- **Sem policy `*_super_admin`.** Super admin não tem caminho cross-tenant pelo cliente a esta
  tabela. Qualquer acesso futuro de suporte exige Edge Function com auditoria, fora desta fatia.

Observação de desenho: o verificador de `subscription_status` no `WITH CHECK` é uma **recomendação
desta análise**. O padrão atual do projeto aplica `bloqueado`/`cancelado` só na app
(`RequireActiveSubscription`), não no banco. Ver decisão Q2 (§12).

---

## 5. Segurança e LGPD

### 5.1 Matriz de acesso

| Papel | Lê ficha | Registra | Corrige | Vê o histórico de outro profissional |
|---|:-:|:-:|:-:|:-:|
| `admin` (do tenant) | tudo do tenant | qualquer atendimento em `em_atendimento`/`concluido` | sim | sim |
| `professional` | só atendimentos próprios | só atendimentos próprios | só os próprios | **não** (decisão Q1) |
| `receptionist` | **não** | **não** | **não** | não |
| `super_admin` | **sem caminho** | sem caminho | sem caminho | sem caminho |

A matriz é aplicada pelo banco. A UI só reflete o que o RLS já decide: recepção nem renderiza a
seção clínica.

### 5.2 Isolamento multi-tenant

- `tenant_id` derivado de `current_tenant_id()`. Nenhum parâmetro de `tenant_id` ou `segment`
  vindo do cliente.
- FKs compostas com `tenant_id` em todas as relações (cliente, atendimento, correção). Coerência
  verificada no schema.
- Teste obrigatório: usuário de outro tenant não lê, não insere e não corrige ficha (§7, AC-C9).

### 5.3 Fronteiras de segmento

- `segment` não aparece em nenhuma cláusula de RLS. Tenant legado (`null`) e tenant de outro ramo
  não têm acesso a esta tabela por causa do ramo, e sim por causa do papel e do vínculo.
- Gating de rota (`clinicalRecord === false`) é só UI. Ele evita render e request indevidos, mas não
  é a trava de dados.

### 5.4 Dado clínico fora do banco (proibido)

- **Logs:** nenhum `console`, nenhum log de Edge Function, nenhuma mensagem de erro com conteúdo de
  campo. Erros de validação mostram o nome do campo, nunca o valor.
- **Mensagens de exceção do banco:** as triggers e constraints não ecoam valores de texto. As
  constraints de texto não têm índice único em conteúdo, então o detalhe de erro não traz o conteúdo.
- **Payloads de listagem:** agenda, lista de clientes e dashboard não consultam `clinical_records`.
  Não há indicador de "tem ficha" nessas telas, para não revelar existência de dado clínico à
  recepção.
- **WhatsApp:** nenhuma variável de template referencia campo clínico. A whitelist de variáveis
  não recebe campo novo desta fatia. Mensagem de cobrança e confirmação não citam ficha.
- **Terceiros:** Evolution API e Asaas são processadores externos. Conteúdo clínico nunca é enviado
  a eles.
- **Cache do cliente:** dado de ficha fica no TanStack Query. O logout e a troca de sessão precisam
  limpar o cache (`queryClient.clear()`). Verificar se já existe esse ponto; se não existir, incluir.
- **Telemetria:** nenhuma ferramenta de analytics recebe conteúdo de ficha.
- **Backups:** o Supabase cifra o disco. Backups herdam essa proteção. Nada extra é exigido aqui.

### 5.5 Dados pessoais e minimização

- Ficha guarda só os três campos de §4.1. Sem CPF, RG, endereço, convênio ou foto.
- Autor (`created_by`) é um uuid. Para exibir nome, usar `profiles.full_name` na própria ficha,
  sem copiar nome para a tabela.
- Telefone e e-mail do cliente continuam em `customers`, com as regras já existentes. A ficha não
  duplica esses dados.

### 5.6 Base legal e papéis (LGPD)

- Dado de saúde é dado pessoal sensível (art. 5º, II). O tratamento exige base legal específica
  (art. 11). Esta análise **não** define a base legal. O usuário já sinalizou ciência; a escolha da
  base (por exemplo, tutela da saúde por profissional de saúde ou consentimento do titular) e os
  papéis (controlador = clínica, operador = Atlas Agenda) devem ser validados juridicamente. Esse
  ponto não é aconselhamento jurídico deste pipeline.
- `whatsapp_opt_in` **não** cobre tratamento clínico. Não reaproveitar esse flag como consentimento
  para ficha.

### 5.7 Retenção e eliminação (conflito a decidir)

Append-only preserva o histórico, mas conflita com pedidos de eliminação (LGPD art. 18) quando não
há obrigação legal de guarda. Guarda de prontuário costuma ter prazo definido por conselho de
classe; o prazo depende da profissão atendida. **Decisão desta análise:** a app não oferece
eliminação. Se houver pedido, o tratamento é um procedimento administrativo separado, feito por
operação controlada, com registro de auditoria. Esse procedimento e o prazo de retenção não entram
nesta fatia. Ver Q3 (§12).

### 5.8 Fora de escopo de dados desta fatia

- Anexos, fotos e arquivos de prontuário (Storage). Seria outra superfície sensível.
- Exportação ou impressão de ficha.
- Acesso cross-tenant de suporte (super admin).
- Assinatura digital ou certificação de registro.

---

## 6. Requisitos funcionais (verificáveis)

- **RF-C1 Registrar ficha no atendimento.** Admin ou profissional dono registra a ficha a partir do
  atendimento em `em_atendimento` ou `concluido`. A ação some nos outros status e para os outros
  papéis.
- **RF-C2 Validação.** O formulário valida com zod: `btrim`, limites de §4.1, pelo menos um campo
  preenchido. Mensagens em pt-BR, sem eco do valor digitado.
- **RF-C3 Correção.** Em um registro existente, o usuário com permissão cria um novo registro com
  `supersedes_id`. Não há edição nem exclusão na UI. O histórico mostra "Corrige o registro de
  dd/mm/aaaa hh:mm".
- **RF-C4 Histórico na ficha do cliente.** Lista cronológica decrescente, com data e hora no fuso do
  tenant, autor, atendimento de origem e cadeia de correções. Carregado somente ao abrir a ficha,
  nunca em listagens.
- **RF-C5 Gating de rota.** A rota da ficha lê `clinicalRecord` antes de qualquer query de dado
  clínico. Para outro ramo, mostra `StatePanel` com texto em pt-BR. Nenhum request de dado clínico
  sai nesse caso.
- **RF-C6 Visão por papel.** Recepção não vê a seção nem o botão. Profissional vê só os próprios
  registros (RLS decide; a UI não filtra no cliente).
- **RF-C7 Bloqueio por assinatura.** Tenant `bloqueado` ou `cancelado` não consegue registrar nem
  corrigir. Verificado no banco (§4.8) e na app.
- **RF-C8 Sem conteúdo clínico em log, erro, telemetria ou mensagem** (§5.4).
- **RF-C9 Limpeza de sessão.** Logout ou troca de usuário remove o cache de ficha.
- **RF-C10 Sem regressão.** Barbearia, salão e legado não ganham entrada de ficha. Agenda, clientes,
  comissão e combos seguem iguais.

Não funcionais:

- **RNF-C1:** `typecheck`, `build` e `vitest` verdes. Migrations aplicam com `supabase db reset`.
- **RNF-C2 (RNF01):** nenhuma query nova na agenda ou na lista de clientes. Ficha é carregada sob
  demanda.
- **RNF-C3 (pt-BR):** textos de UI e erros em pt-BR.
- **RNF-C4 (acessibilidade):** labels associados aos campos, foco visível, navegação por teclado,
  `StatePanel` com heading.
- **RNF-C5 (mobile-first):** formulário e histórico funcionais em viewport pequena.

---

## 7. Critérios de aceite testáveis

Cada critério tem um método de prova. A suíte de RLS não existe hoje no repositório (ver §8), então
os itens de banco precisam de teste novo.

- **AC-C1 (registro original).** Tenant `clinica`, profissional dono de atendimento em
  `em_atendimento`: registra ficha com um campo. Linha criada com `created_by = auth.uid()`,
  `supersedes_id is null`. *Prova:* teste de banco + QA visual.
- **AC-C2 (registro após concluído).** Mesmo fluxo com atendimento em `concluido`. *Prova:* teste de
  banco + QA.
- **AC-C3 (status bloqueados).** Insert com atendimento em `pendente`, `confirmado`, `cancelado` ou
  `nao_compareceu` é recusado pelo banco. *Prova:* teste de banco.
- **AC-C4 (conteúdo mínimo).** Registro com os três campos vazios ou só com espaços é recusado.
  Campo acima do limite (501 em alergia, 2001 em observação) é recusado. *Prova:* teste de banco
  e zod (vitest).
- **AC-C5 (imutabilidade).** `update` e `delete` em `clinical_records` falham para `authenticated`
  e para `service_role`. `truncate` falha. Nenhuma linha muda. *Prova:* teste de banco.
- **AC-C6 (correção).** Correção com `supersedes_id` ligado ao mesmo atendimento e cliente é aceita.
  Segunda correção do mesmo registro é recusada pelo índice único. Correção com atendimento ou
  cliente diferente é recusada pela FK composta. *Prova:* teste de banco.
- **AC-C7 (recepção).** Usuário `receptionist` do próprio tenant: `select` retorna zero linhas,
  `insert` é recusado, e a UI não mostra a seção nem o botão. *Prova:* teste de banco + QA com
  login de recepção.
- **AC-C8 (profissional vinculado).** Profissional A lê e registra no próprio atendimento. Não lê
  nem registra no atendimento do profissional B, mesmo do mesmo cliente. *Prova:* teste de banco
  (Q1 decidida como "não") + QA.
- **AC-C9 (isolamento entre tenants).** Usuário de outro tenant (inclusive `clinica`) não lê, não
  insere e não corrige ficha. `tenant_id` enviado pelo cliente é ignorado. *Prova:* teste de banco.
- **AC-C10 (admin).** Admin lê todas as fichas do tenant e registra ou corrige em qualquer
  atendimento permitido. *Prova:* teste de banco + QA.
- **AC-C11 (gating por ramo, negativo).** Acesso por URL direta à rota da ficha num tenant
  `barbearia`, `salao` ou legado (`null`) mostra painel de indisponibilidade pt-BR. Nenhum dado é
  renderizado e nenhum request de ficha sai (verificado na aba de rede). *Prova:* QA visual com
  Chrome DevTools MCP.
- **AC-C12 (gating por ramo, positivo).** Tenant `clinica` acessa a ficha, registra e vê histórico.
  *Prova:* QA visual.
- **AC-C13 (sem conteúdo clínico fora da ficha).** Listagem de clientes, agenda e dashboard não
  disparam query em `clinical_records` (verificado na aba de rede). Nenhum log ou erro exibe valor
  de campo clínico. *Prova:* QA visual + inspeção de código + busca no diff por `console.` e
  `logger` no módulo de ficha.
- **AC-C14 (assinatura).** Tenant `bloqueado` ou `cancelado` não registra nem corrige (teste de
  banco, decisão Q2 aceita). *Prova:* teste de banco.
- **AC-C15 (limpeza de sessão).** Após logout, o cache de ficha não está mais disponível (QA
  com troca de usuário).
- **AC-C16 (sem regressão).** Typecheck, build, vitest e QA sem erro de console nos fluxos de
  agenda, clientes, comissão e combos.
- **AC-C17 (migrations).** `supabase db reset` termina com exit 0 e reaplica sem duplicar objetos.
  *Prova:* execução local.

---

## 8. Testabilidade

**Unit (vitest):**

- `resolveFeatures`: `clinica` liga `clinicalRecord`; `barbearia`, `salao`, `null` e valor sujo
  deixam desligado. Atualizar `src/lib/segment-features.test.ts`.
- Schema zod da ficha: limites, `btrim`, pelo menos um campo, mensagens pt-BR.
- Componente da ficha com `useSegmentFeatures` mockado: `clinicalRecord: false` não renderiza
  formulário nem histórico.

**Banco (recomendado: pgTAP via `supabase test db`, em `supabase/tests/`):**

- O repositório não tem suíte automatizada de RLS (verificado em `origin/master`). Esta fatia cria
  a primeira. Ela cobre AC-C1 a AC-C14.
- Usuários de teste com papéis diferentes, cada um com `profiles` e JWT simulado (`set local
  role authenticated` e `request.jwt.claims`).
- Testes negativos precisam rodar com sessão real do papel, não só com owner.

**Integração e E2E (QA visual, Chrome DevTools MCP):**

- Login de tenant `clinica` e de cada papel (admin, profissional, recepção).
- Login de tenant `barbearia`, `salao` e legado, com acesso por URL direta à ficha.
- Verificar console e aba de rede em cada caminho.

O que **não** pode ser testado automaticamente: adequação jurídica (§5.6, §5.7). Isso fica com o
usuário e, se necessário, com assessoria jurídica.

---

## 9. Base de exemplo por segmento (pedido original, item a decidir)

O pedido original pede uma base de exemplo para barbearia, salão e clínica, com usuário por
segmento e senha `demo`. Este item **não pode ser descartado**. Ele tem risco específico:

- **Senha `demo` é conhecida e fraca.** Se a conta existir num projeto Supabase acessível pela
  internet, qualquer pessoa entra no tenant demo. Em projeto de produção, isso é falha de segurança.
- **Conflito de tamanho mínimo.** `demo` tem 4 caracteres. O Auth do Supabase, sem configuração
  explícita (`supabase/config.toml` não define `minimum_password_length`), exige 6 por padrão. Isso
  é o padrão do GoTrue, não verificado no projeto remoto. O usuário precisa escolher: manter `demo`
  com configuração de Auth ajustada, ou usar senha de 6+ caracteres.
- **Seed não pode ser migration.** Migration roda em todo ambiente, inclusive produção. Seed de
  usuário com senha conhecida não cabe em `supabase/migrations`.

**Proposta de tratamento (aguarda confirmação do usuário):**

1. Script de desenvolvimento em `scripts/` (não em `src/`, nunca no bundle), executado localmente
   ou contra projeto de demonstração dedicado.
2. Usa service role **só** a partir de variável de ambiente local. Nunca em `.env` commitado.
3. Recusa rodar se a URL não for local (`127.0.0.1`/`localhost`) ou se não estiver numa allowlist
   explícita. Exige flag `ATLAS_DEMO_SEED=1`.
4. Cria um tenant por segmento (`barbearia`, `salao`, `clinica`) e usuários por segmento. Para
   `clinica`, criar também um profissional e uma recepção, para validar RBAC da ficha.
5. Dados fictícios: nomes genéricos, telefones em faixa reservada, sem PII real.
6. Idempotente: rodar de novo não duplica. Se o tenant já existir, pula.
7. Para clínica, inclui atendimentos em `em_atendimento` e `concluido` e alguns registros de ficha,
   para o histórico aparecer na demonstração.
8. Nenhuma senha demo entra em código versionado. A senha vem de variável de ambiente local, com
   valor padrão só para ambiente local.

**Confirmação necessária antes de rodar contra remoto:** o usuário decide (a) a senha (`demo` com
ajuste de Auth, ou 6+ caracteres), e (b) se a base vai para um projeto de demonstração separado do
de produção. Sem esse aval, o seed só roda localmente.

---

## 10. Riscos e armadilhas

- **Frontend chamar `supabase.from('clinical_records')` na listagem.** Mitigado por AC-C13 e por
  revisão do diff.
- **Recepção ver a ficha por algum atalho de UI** (botão, badge, contador). Mitigado por AC-C7 e
  pela regra de não indicar existência na agenda e na lista.
- **Confundir gating de rota com fronteira de dado.** Ver §5.3.
- **Esquecer `with check` na policy de insert.** Sem ele, uma linha de outro tenant poderia entrar.
- **Correção sem vínculo ao mesmo atendimento.** Impedido pela FK composta de correção.
- **Erro do banco com valor de campo no log.** Mitigado por constraints sem eco de conteúdo e pelo
  texto fixo da trigger.
- **Cache de ficha após logout.** Mitigado por RF-C9 e AC-C15.
- **Seed com senha conhecida em remoto.** §9.
- **Branch errada.** Partir da branch de combos traz migrations de salão duplicadas ou fora de
  ordem. Partir de `origin/master` (§1).
- **Migration editada depois de aplicada.** Proibido. Qualquer ajuste vira migration nova.

---

## 11. Enquadramento de fronteiras (checklist do steering)

- RLS habilitado em toda tabela nova: sim (`clinical_records`).
- `tenant_id` do JWT/profiles, nunca do cliente: sim.
- Super admin cross-tenant só por Edge Function auditada: sem caminho nesta fatia.
- RBAC admin / professional / receptionist: sim, conforme §5.1.
- Recepção não lê dado sensível: sim.
- Prevenção de conflito de agenda (`no_overlap`): não afetada.
- Webhooks, idempotência e autenticidade: não aplicável (nenhum webhook nesta fatia).
- Segredos fora do cliente: sim, nenhum segredo novo; seed usa service role só local.
- Dinheiro em `*_cents`, tempo em `timestamptz` UTC: a ficha não tem dinheiro. `created_at` é UTC.
- LGPD: §5.

---

## 12. Decisões e perguntas em aberto

Decisões tomadas por esta análise (o planejador pode contestar com justificativa):

- **D-C1:** ficha é append-only, com correção por registro novo (§4.3). Motivo: pedido do usuário
  e recomendação de `dominio.md`.
- **D-C2:** profissional acessa só atendimentos próprios (§5.1). Motivo: mínimo privilégio; decisão
  Q1 abaixo.
- **D-C3:** registro só em `em_atendimento` ou `concluido` (§4.5). Motivo: pedido do usuário.
- **D-C4:** o vínculo profissional/usuário usa `professionals.profile_id`, como em
  `appointments` e `professional_commissions`. `profiles` não tem `professional_id`.
- **D-C5:** `segment` fora do RLS (§5.3). Motivo: `seguranca-multitenant.md`.
- **D-C6:** nenhuma Edge Function nesta fatia. Leitura e escrita via PostgREST com RLS.

Perguntas que o usuário precisa responder (sem resposta, o planejador usa o default indicado):

- **Q1 — Histórico entre profissionais.** Um profissional pode ver a ficha que outro profissional
  registrou no mesmo cliente? **Default adotado: não.** Só os próprios atendimentos. Se a clínica
  quiser histórico compartilhado, muda a policy de SELECT.
- **Q2 — Bloqueio de escrita no banco.** Aplicar `bloqueado`/`cancelado` também no `WITH CHECK`?
  Diverge do padrão atual, que é só na app. **Default recomendado: sim.**
- **Q3 — Retenção e eliminação.** Qual prazo de guarda e qual procedimento para pedido de eliminação?
  Depende da profissão atendida e de orientação própria. **Fora desta fatia; decisão do usuário.**
- **Q4 — Base legal (§5.6).** Qual base legal a clínica usa? Não é decisão técnica. **Fora desta
  fatia; validar com assessoria jurídica.**
- **Q5 — Campos básicos (§4.1).** Os três campos (alergias, medicamentos, observações) cobrem o que
  o usuário quer? **Default: estes três.**
- **Q6 — Base demo (§9).** Senha `demo` com ajuste de Auth, ou senha de 6+ caracteres? Seed roda só
  local, ou também num projeto de demonstração? **Sem resposta, o seed fica local e a senha é
  ajustada para 6+ caracteres.**

---

## 13. Critérios de pronto desta análise

- Requisitos e critérios de aceite testáveis: §6 e §7.
- Modelo de dados e migrations com ordem e nomes: §4.
- Políticas RLS por papel e intenção de cada uma: §4.8 e §5.1.
- Enquadramento no roadmap: §1.
- Pontos do usuário registrados e nenhum descartado: §3, §4.5 (durante/após concluído), §5 (LGPD e
  recepção), §9 (base demo), §12 (perguntas).
- Nenhum código de aplicação escrito. O DDL de §4.7 é contrato de dados, para o planejador
  transformar em migration.
