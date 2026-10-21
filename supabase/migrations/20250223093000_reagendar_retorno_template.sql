-- Migration: template reagendar_retorno — 5ª chave da régua (ADR-01 Fatia 2, R10/R14)
-- A resposta "2" do cliente (reagendar) enfileira uma mensagem automática de retorno
-- (`reagendar_retorno`): "recebemos seu pedido, em breve entramos em contato". Decisão "c" do
-- usuário — só mensagem, sem reagendamento automático. A chave nova precisa de PARIDADE em 3
-- lugares de banco (o frontend/Edge espelham na ADR-06/ADR-03): CHECK de `messages.template`,
-- CHECK de `message_templates.template_key`, e seed + backfill. Divergência vira bug.
--
-- Não se pode editar as migrations aplicadas (20250220091000_messages,
-- 20250222090000_message_templates, 20250222091000_message_templates_baseline — regra de
-- versionamento). Esta migration nova faz as alterações aditivas:
--
-- 1. CHECKs recriados com nome ESTÁVEL. Os CHECKs originais foram declarados inline na coluna, o
--    que faz o Postgres gerar o nome `<tabela>_<coluna>_check` (`messages_template_check`,
--    `message_templates_template_key_check`). Dropamos o CHECK existente (qualquer que seja o
--    nome: tentamos o auto-nome com `if exists`) e adicionamos um CHECK NOMEADO com as 5 chaves,
--    num bloco `do $$` que confere `pg_constraint` para idempotência no re-apply (não duplica
--    constraint, não erra se já existir).
--
-- 2. Função `seed_message_templates(uuid)` recriada com `create or replace` adicionando a 5ª
--    linha (`reagendar_retorno`) ao VALUES, mantendo as 4 existentes IDÊNTICAS. `on conflict
--    (tenant_id, template_key) do nothing` preserva a idempotência (re-chamar não duplica).
--
-- 3. Backfill idempotente: `insert ... select` da nova chave × tenants `on conflict do nothing` —
--    todo tenant legado ganha a 5ª linha. O re-apply (db reset) não duplica.
--
-- Texto pt-BR sem PII, usando só a lista fechada de variáveis da fatia ({nome}{servico}
-- {dataHora}{empresa}) — {valor} fica fora (depende do módulo Asaas). Nenhum segredo no SQL.

-- ============================================================================
-- 1. CHECK de messages.template: substitui pelo conjunto com 5 chaves, nome estável.
-- ============================================================================
do $$
begin
  -- remove o CHECK antigo (auto-nomeado pelo Postgres na coluna) se ainda existir.
  if exists (
    select 1 from pg_constraint
    where conname = 'messages_template_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages drop constraint messages_template_check;
  end if;
  -- (re)cria o CHECK com as 5 chaves, sob nome estável, só se ainda não existir.
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_template_allowed_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_template_allowed_check
      check (template in
        ('confirmacao','lembrete_d1','cobranca','comprovante','reagendar_retorno'));
  end if;
end
$$;

-- ============================================================================
-- 2. CHECK de message_templates.template_key: mesmo tratamento.
-- ============================================================================
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'message_templates_template_key_check'
      and conrelid = 'public.message_templates'::regclass
  ) then
    alter table public.message_templates drop constraint message_templates_template_key_check;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'message_templates_template_key_allowed_check'
      and conrelid = 'public.message_templates'::regclass
  ) then
    alter table public.message_templates
      add constraint message_templates_template_key_allowed_check
      check (template_key in
        ('confirmacao','lembrete_d1','cobranca','comprovante','reagendar_retorno'));
  end if;
end
$$;

-- ============================================================================
-- 3. seed_message_templates(uuid) recriada: 4 chaves originais IDÊNTICAS + a 5ª nova.
--    Mantém security definer + search_path fixo (roda fora do RLS do chamador no signup).
-- ============================================================================
create or replace function seed_message_templates(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_templates (tenant_id, template_key, body)
  select p_tenant_id, k.template_key, k.body
  from (values
    ('confirmacao',
     'Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}.'),
    ('lembrete_d1',
     'Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
    ('cobranca',
     'Olá {nome}, segue a cobrança do seu {servico} na {empresa}.'),
    ('comprovante',
     'Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!'),
    ('reagendar_retorno',
     'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.')
  ) as k(template_key, body)
  on conflict (tenant_id, template_key) do nothing;
end;
$$;

-- ============================================================================
-- 4. Backfill idempotente: todo tenant legado ganha a 5ª linha (reagendar_retorno).
-- ============================================================================
insert into message_templates (tenant_id, template_key, body)
select t.id, 'reagendar_retorno',
  'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.'
from tenants t
on conflict (tenant_id, template_key) do nothing;
