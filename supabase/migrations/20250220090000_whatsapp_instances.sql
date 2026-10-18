-- Migration: whatsapp_instances — conexão de WhatsApp do tenant (ADR-02 WhatsApp)
-- Materializa a entidade `whatsapp_instances` de dominio.md: UMA conexão de número por
-- tenant, com estado observável (`desconectado -> aguardando_qr -> conectado`). É a fundação
-- da tela de conexão (ADR-07) e da operação `pair` da Edge Function (ADR-04). Recorte da fase:
-- uma instância por tenant (sem múltiplos números).
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` com `default current_tenant_id()`
-- (deriva do JWT/profiles, NUNCA vem do cliente), índice por tenant e RLS habilitado com
-- policies USING + WITH CHECK ancoradas em `current_tenant_id()` / `current_role_name()`
-- (helpers security definer da Fase 2, reutilizados — NÃO recriados). Lição confirmada
-- (migration 20250218090000): sem o default, o WITH CHECK reprova a escrita do cliente, que
-- por regra de isolamento não envia tenant_id.
--
-- Segredos fora do schema: QR é efêmero (devolvido pela Edge Function, exibido, nunca
-- persistido) e a credencial/token da Evolution vive só em env do servidor. Esta tabela NÃO
-- tem coluna de QR nem de token/segredo — evita vazamento acidental de credencial em coluna.
-- `evolution_instance_name` é apenas o nome lógico derivado do tenant, sem segredo.
--
-- Recorte "uma instância por tenant" travado no banco: `unique (tenant_id)` barra a 2ª
-- instância do mesmo tenant — não só na UI.
--
-- RBAC (PRD §5): o estado da conexão não é dado financeiro, então todo papel operacional
-- (admin/receptionist/professional) LÊ. A escrita pelo cliente é só do `admin` — parear é ato
-- de configuração do dono do tenant. Na prática a transição de estado roda pela Edge Function
-- (service role, que bypassa RLS); esta policy de write existe para ajustes do admin e para
-- manter o padrão. super_admin sem caminho cross-tenant pelo cliente (fase futura via service
-- role/Edge Function auditada). Nenhuma policy *_super_admin aqui.
--
-- Convenções: inglês/snake_case/plural; `created_at`/`last_connected_at` timestamptz (UTC).
-- Idempotente no re-apply (create table if not exists / drop policy if exists). Nenhum segredo
-- no SQL. Role de app (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- whatsapp_instances — conexão de WhatsApp do tenant (uma por tenant).
-- ============================================================================
create table if not exists whatsapp_instances (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null default current_tenant_id() references tenants (id) on delete cascade,
  -- nome lógico derivado do tenant, SEM segredo (token/credencial vivem em env do servidor).
  evolution_instance_name  text not null check (char_length(evolution_instance_name) between 1 and 120),
  connection_status        text not null default 'desconectado'
                           check (connection_status in ('desconectado','aguardando_qr','conectado')),
  -- nulo até o 1º pareamento bem-sucedido.
  last_connected_at        timestamptz,
  created_at               timestamptz not null default now(),
  -- recorte da fase: uma instância por tenant — travado no banco, não só na UI.
  constraint whatsapp_instances_tenant_unique unique (tenant_id)
);

create index if not exists whatsapp_instances_tenant_id_idx on whatsapp_instances (tenant_id);

alter table whatsapp_instances enable row level security;

-- SELECT: qualquer papel operacional do tenant vê o estado da conexão (não é dado financeiro).
-- super_admin sem caminho pelo cliente a esta tabela.
drop policy if exists whatsapp_instances_select_same_tenant on whatsapp_instances;
create policy whatsapp_instances_select_same_tenant on whatsapp_instances for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );

-- Escrita: só admin do tenant (parear é configuração do dono). WITH CHECK espelha o USING para
-- barrar gravar linha de outro tenant (combinado com o default, o INSERT do cliente — sem
-- tenant_id — recebe o tenant do JWT e passa; cross-tenant continua barrado). A transição de
-- estado na operação real roda pela Edge Function (service role, bypassa RLS).
drop policy if exists whatsapp_instances_write_admin on whatsapp_instances;
create policy whatsapp_instances_write_admin on whatsapp_instances for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );
