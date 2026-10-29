-- Migration: hardening de privilégios de profiles e tenants (ADR-02, ADR-03, ADR-04)
-- Fecha as brechas de privilégio do PRD de segurança. Esta migration é nova. Ela não foi
-- confirmada no hospedado: a ADR-05 (passo 14) checa esse ponto antes da PR. As seções de
-- tenants (ADR-03) e de TRUNCATE (ADR-04) são acrescentadas aqui. Depois do merge, qualquer
-- correção vira migration nova.
--
-- Seção profiles (ADR-02, achado sec-profiles-role-escalation, crítico):
-- a policy profiles_update_self_or_admin (migration 20250216091000, já aplicada) não restringe
-- colunas, e authenticated tinha UPDATE na tabela inteira. Um usuário alterava o próprio `role`
-- para admin ou super_admin, e um admin promovia um colega a super_admin.
--
-- Estratégia (PRD S-01): duas camadas.
--   1. Grant de coluna (fronteira principal). Authenticated perde o UPDATE de tabela e recebe
--      UPDATE só em `full_name`. Qualquer outra coluna (role, tenant_id, id) é recusada pelo
--      motor com SQLSTATE 42501, sem código extra. Authenticated também perde INSERT e DELETE de
--      tabela: a policy profiles_super_admin (FOR ALL, migration 20250216091000) liberava a
--      super_admin um DELETE seguido de INSERT, que trocava role e tenant_id. Não há fluxo do
--      app que insira ou apague profile: a linha nasce no trigger handle_new_user (security
--      definer). Vale para todos os papéis do cliente, inclusive super_admin: a troca de papel
--      fica para Edge Function com service role ou RPC security definer auditada (backlog, S-06).
--   2. Policy profiles_update_self_or_admin, recriada com USING restrito à própria linha
--      (`id = auth.uid()`): um admin altera só o próprio full_name, como a PRD §5 prevê (decisão
--      B aprovada pelo usuário, prd-approval.json, item 7). Antes, o USING da master deixava o
--      admin alterar o full_name de qualquer colega do tenant. O WITH CHECK exige (a) tenant do
--      usuário, ou super_admin, e (b) que a linha nova não fique com role super_admin, a menos
--      que quem grava seja super_admin (PRD §2.1, aprovado pelo usuário; remove o desvio 1c).
--      A policy enxerga só a linha nova, não OLD.role: ela barra a promoção a super_admin, mas
--      não o rebaixamento. O rebaixamento fica barrado pelo grant
--      (item 1).
--
-- Super admin: a policy profiles_super_admin passa a ser só SELECT (ver seção profiles). Sem essa
-- redução, a escrita FOR ALL somava por OR à policy de UPDATE e permitia gravar full_name de outro
-- tenant pelo cliente.
--
-- Escrita de anon: anon perde INSERT e DELETE de tabela em profiles (revokes abaixo; INSERT pelo
-- review da ADR-02, DELETE pela aprovação do usuário). Mantém UPDATE de tabela, sem
-- revoke. Para UPDATE, a RLS é a única barreira: sem policy permissiva para anon, ele não altera
-- linha alguma. O smoke 00-smoke-anon (ADR-01) aceita 42501 só no DELETE de profiles. Residual:
-- anon não tem barreira de coluna além da RLS para UPDATE. Se uma policy permissiva para anon
-- surgir, role e tenant_id ficam graváveis por anon. A correção é backlog (PRD S-07). O TRUNCATE
-- de anon, authenticated e service_role sai na seção 4 desta migration (ADR-04).
--
-- Convenções: nenhum dinheiro aqui (sem *_cents); nenhum tempo aqui.

-- 1. Seção profiles.
revoke update on table public.profiles from authenticated;
revoke insert, delete on table public.profiles from authenticated;
-- TRIGGER e REFERENCES também saem de authenticated e anon. Com TRIGGER, um usuário anexava um
-- trigger em profiles que fazia todo UPDATE da tabela falhar, para todos os tenants (review ADR-02).
revoke trigger, references on table public.profiles from authenticated, anon;
-- anon não tem motivo para inserir profile: a linha nasce no trigger handle_new_user (security
-- definer). Sem o revoke, anon mantinha INSERT de tabela e dependia só da RLS (review ADR-02).
revoke insert on table public.profiles from anon;
-- DELETE de anon sai também (aprovação do usuário, prd-approval.json, nota 2). Sem linha afetada
-- por RLS: anon recebe 42501 de permissão antes da policy.
revoke delete on table public.profiles from anon;
grant update (full_name) on table public.profiles to authenticated;

-- O nome profiles_update_self_or_admin é histórico: vem da master e não descreve mais o
-- comportamento. Desde a decisão B (prd-approval.json, item 7), a policy libera só a própria
-- linha (USING id = auth.uid()) e não dá poder de admin sobre colegas. O nome é mantido de
-- propósito: o drop policy if exists abaixo troca a definição no mesmo nome, em qualquer banco
-- que já tenha a policy da master. Renomear criaria uma policy órfã nesses bancos.
drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin on public.profiles for update
  using (id = auth.uid())
  with check (
    (
      tenant_id = current_tenant_id()
      or current_role_name() = 'super_admin'
    )
    and (
      role <> 'super_admin'
      or current_role_name() = 'super_admin'
    )
  );

-- Super admin: a policy profiles_super_admin (FOR ALL, migration 20250216091000, já aplicada)
-- somava escrita por OR com a policy de UPDATE acima e deixava o super_admin gravar full_name de
-- profile de outro tenant pelo cliente, sem trilha. Ela é reduzida a SELECT (não removida): o
-- super_admin continua lendo todos os tenants. Escrita cross-tenant fica para caminho explícito e
-- auditado (PRD §4.1 e S-06, backlog). Desvio de PRD §4.2 registrado na ADR-02, decisão humana.
drop policy if exists profiles_super_admin on public.profiles;
create policy profiles_super_admin on public.profiles for select
  using (current_role_name() = 'super_admin');

-- 2. Função seed_message_templates(uuid, text) (migração 20250225091000, já aplicada).
-- É SECURITY DEFINER e não tinha REVOKE: PUBLIC, e por herança anon e authenticated, mantinham
-- EXECUTE. Chamada por anon, ela inseria 5 linhas em message_templates de um tenant qualquer,
-- quebra de isolamento (RNF03, review da ADR-02). Quem a chama de verdade é handle_new_user e o
-- backfill, ambos rodando como owner (postgres), que continua com EXECUTE. Nada do src/ chama
-- esta função, então o revoke não muda comportamento do app.
revoke all on function public.seed_message_templates(uuid, text) from public, anon, authenticated;

-- 3. Seção tenants (ADR-03, achado de bypass de assinatura).
-- A policy tenants_update_own_admin (migration 20250216091000, já aplicada) já limita a linha ao
-- tenant do admin. Mas authenticated tinha UPDATE na tabela inteira: um admin trocava
-- subscription_status (trial para ativo, sem pagamento), plan e trial_ends_at, e os controles por
-- status deixavam de valer. A fronteira é a coluna: só os dados cadastrais ficam graváveis.
-- As policies de tenants não mudam (o escopo de linha está certo, PRD §4.1).
-- segment e owner_email ficam de fora (PRD S-03 e S-04). segment muda a cobrança por função, e
-- owner_email espelha auth.users.email. Super admin continua com tenants_super_admin, mas perde a
-- troca de status e plano pelo cliente (PRD S-06). Anon mantém UPDATE de tabela, e a RLS barra
-- (backlog S-07).
-- INSERT e DELETE de tabela também saem de authenticated (review da ADR-03). A policy
-- tenants_super_admin é FOR ALL, então o super admin apagava a empresa e a recriava com
-- subscription_status = 'ativo' e plan = 'pro', contornando o UPDATE protegido. O DELETE também
-- apagava em cascata os dados do tenant. O signup não depende desse grant: insere em tenants pelo
-- trigger handle_new_user (security definer), e o app só lê tenants (src/hooks/useTenant.ts).
revoke update on table public.tenants from authenticated;
revoke insert, delete on table public.tenants from authenticated;
grant update (trade_name, legal_name, phone, document, timezone) on table public.tenants to authenticated;
-- TRIGGER e REFERENCES saem de authenticated e anon (review da ADR-03, mesmo critério de profiles).
-- Com TRIGGER, um usuário anexava um trigger em tenants que fazia todo UPDATE da tabela falhar.
revoke trigger, references on table public.tenants from authenticated, anon;
-- anon também perde INSERT e DELETE de tabela em tenants (review da ADR-03, mesmo critério de
-- profiles na ADR-02). A RLS já negava as duas, então nenhum fluxo muda. O UPDATE de anon segue
-- no backlog S-07.
revoke insert, delete on table public.tenants from anon;
-- timezone passa a ser validado no banco (review da ADR-03). Um valor fora de pg_timezone_names,
-- como 'Mars/Olimpo', faz Intl lançar RangeError nas telas de agenda, dashboard e comissões da
-- empresa. Valores válidos passam sem mudança; o default America/Sao_Paulo é válido.
create or replace function public.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;
-- Só o trigger chama esta função. EXECUTE sai de PUBLIC, anon e authenticated, no mesmo padrão de
-- seed_message_templates (review da ADR-03). O disparo do trigger não checa EXECUTE de quem faz o
-- UPDATE, então a validação continua valendo.
revoke all on function public.validate_tenant_timezone() from public, anon, authenticated;

drop trigger if exists tenants_validate_timezone on public.tenants;
create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function public.validate_tenant_timezone();
-- 4. TRUNCATE (ADR-04, defesa em profundidade, PRD RF-08 a RF-10).
-- A default ACL do schema public concede arwdDxt a anon, authenticated e service_role em toda
-- tabela criada pelo postgres. O PostgREST não expõe TRUNCATE, mas SQL ou RPC executada com esses
-- roles poderia truncar uma tabela de domínio. service_role entra na revogação (PRD S-05): nenhum
-- código da master usa TRUNCATE. O owner (postgres) mantém o privilégio, porque revoke não tira
-- privilégio do próprio owner.
revoke truncate on all tables in schema public from anon, authenticated, service_role;
-- Tabelas futuras criadas pelo postgres também nascem sem TRUNCATE para esses roles. Quem precisar
-- de TRUNCATE concede em migration própria.
alter default privileges in schema public revoke truncate on tables from anon, authenticated, service_role;
