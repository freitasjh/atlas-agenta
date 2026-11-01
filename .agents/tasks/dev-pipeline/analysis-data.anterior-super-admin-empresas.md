# Análise de Dados & Segurança — Painel do Super Admin, Fatia 1 (Empresas: listar + operar status)

Papel: ANALISADOR DE DADOS E SEGURANÇA do dev-pipeline. Este documento produz
requisitos verificáveis, critérios de aceite testáveis, modelo de dados + migrations e o
enquadramento no roadmap. **Não contém código de aplicação** (frontend/Edge Function ficam
para as fases de design/implementação). O que está aqui é a fronteira de dados/RLS/RBAC
resolvida antes de qualquer código, como a demanda exige ("demanda de peso/segurança").

Fontes da verdade consultadas: `.kiro/steering/{produto,dominio,stack,seguranca-multitenant,convencoes-codigo}.md`;
skill `supabase-multitenant`; brain (project `atlas-agenda`); código atual
(`src/admin/pages.tsx`, `AdminLayout.tsx`, `src/types/domain.ts`, `src/hooks/*`,
`supabase/functions/whatsapp/index.ts`, `supabase/migrations/*`).

---

## 1. Summary

A Fatia 1 do painel `/admin` (hoje 100% placeholder em `src/admin/pages.tsx`) ganha conteúdo
real em **Empresas**: (1) **lista cross-tenant** de todas as empresas assinantes (`tenants`)
com nome, plano, status de assinatura, fim do trial, busca por nome e filtro por status; e
(2) **operação de mudança do `subscription_status`** de uma empresa (ex.: bloquear
inadimplente, reativar) por **caminho auditado**. Fora de escopo: instâncias de WhatsApp por
tenant e métricas consolidadas da plataforma.

Esta é uma demanda que **cruza a fronteira multi-tenant** (super_admin vê dados de todas as
empresas) e **mexe em privilégio de assinatura** (o status trava escrita operacional e
disparos nos demais módulos). Por isso a análise de dados/RLS/RBAC é front-loaded.

### Achado crítico de segurança no estado atual (base `master` desta árvore)

Ao ler as migrations aplicadas, **a migration de endurecimento de privilégios
`20250228090000_security_privilege_hardening.sql` citada no brain (ADR-02) NÃO existe nesta
árvore de código**. Última migration presente: `20250226096000_appointments_combo.sql`. Logo,
nesta base:

- A policy **`tenants_super_admin` é `FOR ALL`** (criada em
  `20250216091000_profiles_and_helpers.sql`, linhas finais) — `using`/`with check`
  `current_role_name() = 'super_admin'`. Ela **já permite ao super_admin fazer UPDATE de
  qualquer coluna de qualquer tenant pelo cliente**, inclusive `subscription_status`, **sem
  validação de transição e sem trilha de auditoria**.
- **Não há REVOKE de coluna** nem de `UPDATE` de `tenants` para `authenticated`/super_admin
  (confirmado por busca: só funções de cron têm REVOKE; nenhuma tabela `tenants`).

Isso é **exatamente o defeito** que a demanda nomeia: "permitir mudança de status de
assinatura pelo cliente (anon/authenticated) em vez de Edge Function com service role
auditada" e "transição de status sem validação". **Portanto a Fatia 1 não é só "adicionar uma
Edge Function"; ela precisa FECHAR o caminho de escrita pelo cliente**, senão o caminho
auditado conviveria com um bypass. Decisão em §4.

> Observação para o planejador: a ADR-02/ADR-03 do brain descrevem esse endurecimento
> (`profiles_super_admin` reduzida a SELECT; INSERT/DELETE de tenants revogados) como **já
> decidido e aprovado pelo usuário** num hotfix (branch `fix/seguranca-privilegios...`). Se
> esse hotfix foi mergeado em outra linha e esta árvore está atrás, o planejador deve
> **rebase/confirmar a base** antes de codar. Como esta análise só enxerga o que está na
> árvore, ela trata o estado atual como verdade e **inclui o fechamento do bypass como parte
> da fatia** — se o hotfix já tiver fechado `tenants_super_admin`/coluna, a migration desta
> fatia vira no-op idempotente naquela parte e nada quebra. Não reabrimos as decisões do
> brain; só garantimos que o caminho auditado seja o único.

---

## 2. Valor de negócio

- **Operação da plataforma (super admin):** fundadores precisam de um lugar único para ver
  todas as empresas e agir sobre a assinatura — bloquear inadimplente (corta escrita
  operacional e disparos nos módulos existentes, que já checam `subscription_status`),
  reativar quem quitou, acompanhar quem está em `trial`/`pendente`. Hoje isso só é possível
  por `psql` direto no banco.
- **Receita e inadimplência:** `bloqueado`/`cancelado` são a alavanca de cobrança do
  Micro-SaaS. Tê-los operáveis com um clique, de forma auditada, é pré-requisito para a régua
  financeira.
- **Confiança/segurança:** transformar um UPDATE cru e sem trilha (estado atual) numa operação
  validada, autenticada e registrada reduz risco de erro operacional e cria auditoria de quem
  mudou o quê e quando — base para LGPD e para disputas de cobrança.

---

## 3. Requisitos

### 3.1 Funcionais

- **RF-01 — Listar empresas (cross-tenant).** O super_admin vê a lista de **todas** as
  `tenants`: nome de exibição (`trade_name`, com fallback para `legal_name`), `plan`,
  `subscription_status`, `trial_ends_at`. Ordenação default por `created_at desc` (mais
  recentes primeiro). A leitura é cross-tenant **só** para super_admin.
- **RF-02 — Buscar por nome.** Filtro textual case-insensitive sobre `trade_name` **e**
  `legal_name` (e, oportunamente, `owner_email`/`document` — ver CA). Busca client-side sobre o
  conjunto já carregado nesta fatia (volume de tenants é pequeno); não é um requisito de
  paginação server-side.
- **RF-03 — Filtrar por status.** Filtro por `subscription_status` (um dos 5 valores ou
  "todos"). Combina com a busca por nome (AND).
- **RF-04 — Mudar o status de assinatura por caminho auditado.** O super_admin seleciona uma
  empresa e um novo `subscription_status`. A operação passa **obrigatoriamente** por Edge
  Function com service role que: (a) confirma que o chamador é `super_admin` pelo JWT/profiles;
  (b) valida que a **transição** é permitida (§5.3); (c) persiste o novo status; (d) **registra
  a operação** numa tabela de auditoria (quem, qual tenant, de→para, motivo opcional, quando).
- **RF-05 — Refletir o novo status na UI.** Após a mudança, a lista reflete o novo status
  (TanStack Query invalida/refetch da query da lista). Sem reload manual.
- **RF-06 — Estados de UI em pt-BR.** Loading, vazio (nenhuma empresa / nenhum resultado de
  filtro) e erro, todos com texto em pt-BR.

### 3.2 Não-funcionais

- **RNF-01 — Isolamento (RNF03 da spec, inegociável).** A leitura cross-tenant acontece
  **apenas** por caminho role-gated (policy `super_admin` auditável) e a escrita de status
  **apenas** pela Edge Function service role. `authenticated` comum (admin/professional/
  receptionist de um tenant) **nunca** lê a lista cross-tenant nem muda status.
- **RNF-02 — `tenant_id`/role do JWT, nunca do cliente.** A Edge Function deriva
  `userId`/`role` do JWT via `profiles` (service role), espelhando `resolveIdentity()` de
  `supabase/functions/whatsapp/index.ts`. Nenhum `tenant_id` nem `role` vem do corpo.
- **RNF-03 — Segredos fora do bundle.** `SUPABASE_SERVICE_ROLE_KEY` só na Edge Function
  (env). Só `anon key` vai ao frontend. Nenhuma chave Asaas/Evolution envolvida nesta fatia.
- **RNF-04 — TypeScript estrito, zod, TanStack Query, shadcn/ui, pt-BR, mobile-first, dark
  mode, acessibilidade.** Toda resposta de PostgREST/Edge Function é dado não confiável:
  validada por zod no hook antes do uso (padrão de `useWhatsAppInstance.ts`).
- **RNF-05 — Migração versionada.** Qualquer mudança de schema é migration nova em
  `supabase/migrations`, idempotente no re-apply, **sem alterar migration já aplicada**.
- **RNF-06 — Auditoria mínima sem PII sensível.** A linha de auditoria não loga documento/
  telefone em claro; guarda ids, status de→para, ator e timestamp (+ motivo curto opcional).

### 3.3 Premissas e pendências (assumidas; o design review valida)

- **A-01 (resolvida pelo usuário):** a mudança de status entra **nesta fatia** e vai **via
  Edge Function** (decisão 3=a). Não há opção "policy super_admin direta" para a escrita.
- **A-02:** a **leitura** da lista usa a **policy `tenants_super_admin` (reduzida a SELECT)**
  em vez de uma Edge Function de listagem — justificativa em §4.2. Se o design/review preferir
  Edge Function também para a leitura (simetria com a escrita, auditando até o GET), é uma
  troca aceitável; registrada como alternativa.
- **A-03:** o conjunto de transições de status válidas (§5.3) é inferido do produto; o usuário
  pode ajustar. Nenhuma transição destrutiva irreversível nesta fatia (não há DELETE de
  tenant — já revogado, ADR-03).
- **A-04:** o guard de rota `/admin` por `super_admin` já existe (contexto confirmado); esta
  fatia **não** reescreve o guard, só consome `usePermissions`/identidade.

---

## 4. Decisões de fronteira (resolvidas antes de codar)

### 4.1 Escrita do status → Edge Function `admin-tenants` com service role (DECIDIDO)

Caminho único de escrita de `subscription_status`: uma **nova Edge Function
`supabase/functions/admin-tenants/`**, espelhando o padrão já estabelecido em
`supabase/functions/whatsapp/index.ts`:

- `createServiceClient()` lê `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` do env (nunca do
  cliente).
- `resolveIdentity(req, service)` — JWT do header `Authorization` → `auth.getUser(token)` →
  lê `profiles(tenant_id, role)` com service role. **Se `role !== 'super_admin'` → 403.** É a
  trava de RBAC do caminho privilegiado.
- Valida o corpo com zod (`action: "set_status"`, `tenantId: uuid`, `newStatus: enum`,
  `reason?: string ≤ 280`). Corpo inválido → 400 pt-BR.
- Carrega o tenant alvo (service role), lê o `subscription_status` atual, **valida a transição**
  (§5.3). Transição inválida → 409 pt-BR (com o par de→para no corpo para a UI).
- Persiste o novo status **e** insere a linha de auditoria — idealmente via RPC
  `security definer` transacional (§5.1) para que status e auditoria sejam atômicos.
- Respostas JSON pt-BR, CORS e tratamento de erro idênticos ao padrão `whatsapp`.

**Por quê Edge Function e não policy `super_admin` direta para a escrita:** é decisão explícita
do usuário (3=a) e da regra `seguranca-multitenant` — escrita privilegiada cross-tenant precisa
de caminho auditado. Policy sozinha não valida transição nem registra trilha.

### 4.2 Leitura da lista cross-tenant → policy `tenants_super_admin` reduzida a **SELECT** (DECIDIDO)

A lista é uma leitura de `tenants` pelo cliente do super_admin usando **anon key + sessão**,
sob a policy role-gated `tenants_super_admin`. Isso **não** é "cliente comum": a policy exige
`current_role_name() = 'super_admin'`, resolvido no banco por função `security definer` — o
`authenticated` de um tenant qualquer não passa. É o mesmo tratamento que a ADR-02 deu a
`profiles_super_admin` (SELECT-only).

**Decisão acoplada obrigatória (fecha o achado crítico de §1):** reduzir a policy
`tenants_super_admin` de `FOR ALL` para **SELECT**. Hoje ela é `FOR ALL` e, somada por OR às
demais policies permissivas, **libera escrita cross-tenant de `subscription_status` pelo
cliente** — o bypass que a Edge Function existe para eliminar. Sem reduzir, haveria dois
caminhos (um auditado, um não). Espelha exatamente a redução feita em `profiles` (ADR-02,
"policies permissivas se somam por OR").

**Consequência de produto a sinalizar:** a ADR-03 do brain registra que o super_admin HOJE
edita cadastro de tenant (`trade_name`, `legal_name`, `phone`, `document`, `timezone`) pelo
cliente (residual S-06 aceito). Reduzir `tenants_super_admin` a SELECT **tira também essa
escrita de cadastro pelo cliente**, não só a de status. Duas saídas, ambas respeitam o
inviolável:

- **Opção A (preferida, mais limitada ao pedido):** manter uma policy de UPDATE para super_admin
  **restrita às colunas de cadastro** via trigger/CHECK que **rejeita** alteração de
  `subscription_status`, `plan`, `trial_ends_at` por caminho não-service-role. Como column-level
  grant "não combina bem com PostgREST" (nota registrada na migration de comissões,
  `20250226090000`), a restrição de coluna vira um **trigger `BEFORE UPDATE`** que barra a
  mudança dessas 3 colunas quando a sessão não é service role (`auth.role() = 'authenticated'`).
  Resultado: cadastro continua editável pelo cliente (preserva o comportamento da ADR-03);
  status/plano/trial só pela Edge Function.
- **Opção B (mais simples, desvio consciente):** reduzir `tenants_super_admin` a SELECT puro,
  tirando toda escrita pelo cliente. Mais seguro e simétrico a `profiles`, mas **altera o
  comportamento de cadastro que o PRD/ADR-03 aprovaram manter**. Exige confirmação do usuário
  porque toca uma decisão já registrada no brain.

**Recomendação:** **Opção A** — ela entrega o objetivo da fatia (status só por caminho
auditado), fecha o bypass de status/plano/trial **e** preserva a decisão ADR-03 de cadastro,
sem reabrir o que o usuário já aprovou. A escrita de status/plano/trial cross-tenant pelo
cliente passa a ser **impossível** (trigger barra), restando só a Edge Function. Fica como
**questão ao gate humano do PRD** se preferem a Opção B. Nenhum ponto do usuário é descartado:
ambos mantêm "status só por Edge Function auditada".

### 4.3 Nenhum INSERT/DELETE de tenant nesta fatia

Confirmado com a ADR-03 (brain `tenants-insert-delete-so-service-role`): criar/apagar empresa é
só Edge Function service role e **não** faz parte desta fatia. A UI só lista e muda status.
Nenhuma migration desta fatia concede INSERT/DELETE ao cliente.

### 4.4 Guard de rota e defesa em profundidade

O acesso a `/admin` já é guardado por `super_admin` no roteamento (contexto). A UI desta fatia
usa `usePermissions`/identidade só como **defesa em profundidade** (esconder a ação para quem
não é super_admin). A trava real é dupla: **RLS** na leitura e **checagem de `super_admin` na
Edge Function** na escrita. Um não-super_admin que forjasse a chamada recebe **403** da função
e **0 linhas** do SELECT.

---

## 5. Modelo de dados e migrations

Convenção: inglês, `snake_case`, tabelas no plural; tempo em `timestamptz` UTC; nenhum dinheiro
nesta fatia (sem `*_cents`). Migrations idempotentes no re-apply (`create ... if not exists`,
`drop policy if exists`, `create or replace`). **Nenhuma migration já aplicada é alterada.**

### 5.1 Nova tabela: `subscription_status_changes` (auditoria)

Materializa RF-04(d)/RNF-06: uma linha por mudança de status, escrita **só** pela Edge Function
(service role). É a trilha de auditoria da operação privilegiada.

```sql
create table if not exists public.subscription_status_changes (
  id            uuid primary key default gen_random_uuid(),
  -- empresa cujo status mudou. Cascata: auditoria some se a empresa for apagada
  -- (apagar empresa já é só service role; coerente manter a trilha ligada à vida da linha).
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  -- ator: o super_admin que operou. Resolvido no servidor pelo JWT, NUNCA do corpo.
  -- set null preserva a trilha se o profile do ator for removido.
  changed_by    uuid references public.profiles (id) on delete set null,
  old_status    text not null
                check (old_status in ('trial','ativo','pendente','bloqueado','cancelado')),
  new_status    text not null
                check (new_status in ('trial','ativo','pendente','bloqueado','cancelado')),
  -- motivo curto opcional (não-PII). Ex.: "inadimplência 30d". Limite na app (zod) e aqui.
  reason        text check (reason is null or char_length(reason) <= 280),
  created_at    timestamptz not null default now()
);

create index if not exists subscription_status_changes_tenant_idx
  on public.subscription_status_changes (tenant_id, created_at desc);

alter table public.subscription_status_changes enable row level security;
```

**RLS (espelha `webhook_events`: auditoria sensível, escrita só service role):**

- **SELECT:** só `super_admin` (auditoria da plataforma, cross-tenant). Nenhum papel de tenant
  lê. (Nesta fatia a UI pode nem exibir o histórico; a policy existe para quando exibir e para
  o super_admin poder auditar.)
  ```sql
  drop policy if exists subscription_status_changes_super_admin on public.subscription_status_changes;
  create policy subscription_status_changes_super_admin
    on public.subscription_status_changes for select
    using (current_role_name() = 'super_admin');
  ```
- **INSERT/UPDATE/DELETE pelo cliente:** **nenhuma policy**. A gravação é exclusiva do service
  role na Edge Function (bypassa RLS). Sem policy de write, qualquer INSERT pelo cliente é
  negado por RLS — não dá para forjar uma trilha falsa. Mesmo princípio de `webhook_events` e
  `messages`.

### 5.2 RPC transacional `admin_set_subscription_status` (SECURITY DEFINER, só service role)

Para que "persistir status" e "gravar auditoria" sejam **atômicos** (RF-04 c+d), a Edge Function
chama uma RPC `security definer` que faz os dois num statement. Padrão de REVOKE das funções de
sistema (ex.: `whatsapp_claim_retry_batch`, `20250223097000`): **revogada de
`public`/`authenticated`/`anon`** — só o service role a invoca.

```sql
create or replace function public.admin_set_subscription_status(
  p_tenant_id  uuid,
  p_new_status text,
  p_changed_by uuid,
  p_reason     text default null
) returns table (old_status text, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  -- Trava a linha do tenant durante a transação (evita corrida de duas mudanças simultâneas).
  select subscription_status into v_old from public.tenants where id = p_tenant_id for update;
  if v_old is null then
    raise exception 'tenant_not_found' using errcode = 'no_data_found';
  end if;

  -- Validação da transição é feita na Edge Function (fonte única, pt-BR) ANTES de chamar;
  -- aqui garantimos a atomicidade e a trilha. (Opcional: repetir o CHECK aqui por defesa.)
  update public.tenants
     set subscription_status = p_new_status
   where id = p_tenant_id;

  insert into public.subscription_status_changes
    (tenant_id, changed_by, old_status, new_status, reason)
  values (p_tenant_id, p_changed_by, v_old, p_new_status, p_reason);

  return query select v_old, p_new_status;
end;
$$;

revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from public;
revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from anon;
revoke all on function public.admin_set_subscription_status(uuid, text, uuid, text) from authenticated;
```

> Alternativa ao RPC: fazer o UPDATE + INSERT direto na Edge Function com dois statements. Fica
> **não-atômico** (se o INSERT de auditoria falhar após o UPDATE, há status sem trilha). Por
> isso a RPC transacional é a escolha. O design pode usar a RPC; o importante do ponto de vista
> de dados é a atomicidade status+trilha.

### 5.3 Fechamento do bypass de escrita em `tenants` (Opção A recomendada, §4.2)

Reduz a superfície de escrita pelo cliente **sem** alterar as migrations originais. Nova
migration que: (a) reduz `tenants_super_admin` a SELECT; (b) recria uma policy de UPDATE para
super_admin **restrita a cadastro**; (c) instala trigger que barra mudança de
`subscription_status`/`plan`/`trial_ends_at` por sessão não-service-role.

```sql
-- (a) super_admin passa a só LER cross-tenant pelo cliente (espelha ADR-02 de profiles).
drop policy if exists tenants_super_admin on public.tenants;
create policy tenants_super_admin_select on public.tenants for select
  using (current_role_name() = 'super_admin');

-- (b) Opção A: super_admin ainda edita CADASTRO de qualquer tenant pelo cliente (preserva ADR-03)...
drop policy if exists tenants_super_admin_update_cadastro on public.tenants;
create policy tenants_super_admin_update_cadastro on public.tenants for update
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

-- (c) ...mas status/plano/trial só mudam por service role (Edge Function). Trigger barra o resto.
create or replace function public.tenants_guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role (Edge Function/RPC) roda sem o papel 'authenticated' do GoTrue: liberada.
  if auth.role() = 'authenticated' then
    if new.subscription_status is distinct from old.subscription_status
       or new.plan is distinct from old.plan
       or new.trial_ends_at is distinct from old.trial_ends_at then
      raise exception 'privileged_column_change_denied'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_guard_privileged_columns_trg on public.tenants;
create trigger tenants_guard_privileged_columns_trg
  before update on public.tenants
  for each row execute function public.tenants_guard_privileged_columns();
```

> Se o planejador optar pela **Opção B** (SELECT puro, sem UPDATE pelo cliente), os passos (b)
> e (c) saem e sobra só (a) — mais simples, porém tira a edição de cadastro pelo cliente
> (desvio da ADR-03 que **exige confirmação do usuário**). A Opção A é a recomendada por não
> reabrir decisão aprovada.
>
> **Nota de idempotência para o planejador:** se a árvore for rebaseada sobre o hotfix da
> ADR-02/ADR-03 (onde `tenants_super_admin` já pode ter sido reduzida), reconciliar os nomes de
> policy antes de aplicar, para o `supabase db reset` continuar limpo. Os `drop ... if exists`
> tornam a migration tolerante, mas nomes divergentes de policy devem ser alinhados.

### 5.4 Ordenação e nomes das migrations

Duas migrations novas, após a última presente (`20250226096000_appointments_combo.sql`),
timestamps crescentes:

1. `20250227090000_subscription_status_audit.sql` — tabela `subscription_status_changes`
   (§5.1) + RPC `admin_set_subscription_status` (§5.2) + REVOKEs.
2. `20250227091000_tenants_privileged_columns_guard.sql` — fechamento do bypass de escrita
   (§5.3).

(Se o hotfix de endurecimento for mergeado antes e já trouxer `20250228090000`, manter estas
abaixo desse timestamp ou reconciliar; o importante é a ordem causal: funções/trigger depois
dos helpers `current_role_name()` de `20250216091000`, que já existem.)

### 5.5 Tipos de domínio (sem código, só o contrato de dados)

O frontend lê linhas de `tenants` cross-tenant com uma projeção nova (super_admin). O contrato
de dados para a lista (a materializar em `src/types/domain.ts` na fase de design):

- `TenantListItem`: `id`, `trade_name: string | null`, `legal_name: string`,
  `document: string | null`, `owner_email: string`, `plan: 'individual'|'clinica'|'pro'`,
  `subscription_status: SubscriptionStatus`, `trial_ends_at: string | null`,
  `created_at: string`. (`SUBSCRIPTION_STATUSES` e `SubscriptionStatus` já existem.)
- Resposta da Edge Function `set_status`: `{ tenant_id, old_status, new_status }` — validada por
  zod no hook, como em `useWhatsAppInstance.ts`.

---

## 6. Critérios de aceite (testáveis, numerados)

Leitura / lista:

- **CA-01** Logado como **super_admin**, `/admin` → Empresas lista **todas** as `tenants`
  (de ≥2 tenants distintos no seed), cada linha com nome (trade_name→legal_name), plano, badge
  de `subscription_status` e fim do trial. Ordem default: `created_at desc`.
- **CA-02** A busca por nome filtra por `trade_name` **e** `legal_name` (case-insensitive);
  digitar o nome de uma empresa específica reduz a lista a ela.
- **CA-03** O filtro por status mostra só empresas no status escolhido; "todos" remove o filtro;
  busca + status combinam por AND.
- **CA-04** Estados **loading**, **vazio** (nenhuma empresa e nenhum resultado de filtro) e
  **erro** aparecem com texto em **pt-BR**.

Escrita / auditoria:

- **CA-05** O super_admin muda o `subscription_status` de uma empresa; a chamada vai para a
  Edge Function `admin-tenants` (não há UPDATE direto de `tenants.subscription_status` no
  cliente). Após sucesso, a lista reflete o novo status sem reload (TanStack Query invalida).
- **CA-06** A Edge Function **recusa com 403** quando o chamador não é `super_admin` (JWT de
  admin/receptionist/professional de um tenant).
- **CA-07** A Edge Function **recusa com 409** uma transição inválida (§5.3), devolvendo
  de→para no corpo; a UI mostra mensagem pt-BR.
- **CA-08** Cada mudança bem-sucedida grava **uma** linha em `subscription_status_changes` com
  `tenant_id`, `changed_by` (= id do super_admin do JWT), `old_status`, `new_status`,
  `reason?`, `created_at`. Status e trilha são atômicos (RPC): se a trilha falhar, o status
  não muda.

Isolamento / segurança (os mais importantes desta fatia):

- **CA-09** Logado como **admin/receptionist/professional** de um tenant, uma leitura de
  `select * from tenants` pelo cliente retorna **só a própria** empresa (ou 0), **nunca**
  outras — a lista cross-tenant é inacessível fora do super_admin.
- **CA-10** Um **authenticated não-super_admin** que tente `update tenants set
  subscription_status=... where id = <outro tenant>` pelo cliente afeta **0 linhas** (RLS) ou
  é barrado pelo trigger — jamais muda status de ninguém.
- **CA-11** Um **super_admin** que tente `update tenants set subscription_status=...` **pelo
  cliente** (anon key + sessão, sem Edge Function) é **barrado pelo trigger**
  (`privileged_column_change_denied`) — o único caminho de status é a Edge Function. (Fecha o
  achado crítico de §1.)
- **CA-12** Opção A: um super_admin **consegue** editar `trade_name`/`phone` de outra empresa
  pelo cliente (preserva ADR-03), mas **não** `subscription_status`/`plan`/`trial_ends_at`
  (trigger barra). [Se Opção B for escolhida, CA-12 vira "super_admin não edita nenhum campo de
  tenant pelo cliente".]
- **CA-13** `SUPABASE_SERVICE_ROLE_KEY` não aparece no bundle do frontend (grep no build);
  nenhum `tenant_id`/`role` é enviado no corpo da chamada da Edge Function.
- **CA-14** `subscription_status_changes` tem **RLS habilitado**; INSERT/UPDATE/DELETE pelo
  cliente (qualquer papel) são negados; só super_admin faz SELECT.

Verificação de build e QA:

- **CA-15** `npm run build` + typecheck + a suíte de testes existente passam. Se houver
  migration, `supabase db reset` aplica tudo limpo e o re-apply é idempotente (contagem de
  policies/trigger estável).
- **CA-16** QA visual via Chrome DevTools em `/admin` → Empresas em **390px** e **1280px**,
  tema **claro** e **escuro**, **console limpo**, com 2 perfis: (i) super_admin vê a lista e
  opera o status; (ii) não-super_admin é barrado (sem lista cross-tenant, sem ação).
- **CA-17** Entrega em **branch nova a partir de `origin/master`** + **PR** com as ADRs e o que
  foi testado.

---

## 7. Out of scope (desta fatia)

- Instâncias de WhatsApp por tenant no painel admin (fatia futura).
- Indicadores/métricas consolidadas da plataforma (Visão Geral permanece placeholder).
- Criar/apagar empresa pelo painel (INSERT/DELETE já são só service role — ADR-03; não entram).
- Editar `plan`/`trial_ends_at` pelo painel (fatia não pediu; o trigger apenas os **protege**
  de escrita pelo cliente, não adiciona UI para eles).
- Paginação/busca server-side de tenants (volume pequeno nesta fase; busca client-side basta).
- Exibir o histórico de `subscription_status_changes` na UI (a tabela e a RLS existem; a tela
  do histórico é fatia futura).

---

## 8. Enquadramento no roadmap

- **Fase 1 (MVP):** agenda, clientes, catálogo, WhatsApp, comissões — já construídos (migrations
  até `20250226096000`).
- **Esta fatia:** primeira entrega real do **Painel do Super Admin** (`/admin`), módulo de
  operação da plataforma. É pré-requisito para a régua de inadimplência (bloquear/reativar
  assinatura de forma auditada) e para as próximas fatias do admin (instâncias de WhatsApp,
  métricas — Fase 3 da spec).
- **Segurança:** formaliza o caminho auditado de escrita privilegiada em `tenants`, fechando o
  bypass de `subscription_status` pelo cliente (achado §1) — na direção do endurecimento que a
  ADR-02/ADR-03 já iniciaram para `profiles`/INSERT-DELETE de `tenants`.

---

## 9. Pontos levantados pelo usuário — rastreamento (nenhum descartado)

- "dar ao cliente comum qualquer acesso cross-tenant" = defeito → RNF-01, §4.2, CA-09.
- "mudança de status pelo cliente em vez de Edge Function auditada" = defeito → RF-04, §4.1,
  CA-05/CA-11.
- "enviar tenant_id do cliente para contornar RLS" = defeito → RNF-02, CA-13.
- "vazar service role no bundle" = defeito → RNF-03, CA-13.
- "transição de status sem validação" = defeito → RF-04(b), §5.3, CA-07.
- "texto de usuário fora de pt-BR" = defeito → RNF-04, RF-06, CA-04.
- Objetivo duplo (ver + operar) confirmado (2=c) → RF-01..RF-05.
- Status via Edge Function nesta fatia (3=a) → §4.1 (decidido, sem alternativa de escrita por
  policy).
- Começar pela lista (1=a) → RF-01 é o núcleo; a ação (RF-04) acompanha.
- Fora da fatia: instâncias de WhatsApp e métricas → §7.

## 10. Questões para o gate humano do PRD

- **Q1 (§4.2):** Opção A (preserva edição de cadastro pelo cliente + protege status/plano/trial
  por trigger) **ou** Opção B (SELECT puro, tira toda escrita de tenant pelo cliente)?
  Recomendação: **A**.
- **Q2 (§1):** esta árvore está **atrás** do hotfix de endurecimento (ADR-02/ADR-03 não
  presentes). Confirmar a base correta (`origin/master`) antes de implementar, para a fatia não
  recriar policies já mudadas noutra linha.
- **Q3 (§5.3):** confirmar o conjunto de transições de `subscription_status` permitidas (quais
  pares de→para são válidos; ex.: `cancelado → ativo` é permitido direto?).
