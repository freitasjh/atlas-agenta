-- Migration: baseline/seed dos 4 templates padrão por tenant (ADR-02 WhatsApp Fase 2, Fatia 1)
-- Garante que NENHUM tenant fique sem os 4 templates da régua (`confirmacao`, `lembrete_d1`,
-- `cobranca`, `comprovante`). A tela (ADR-06) e a renderização no envio (ADR-04) assumem a
-- existência dessas 4 chaves por tenant. Depende de 20250222090000_message_templates.sql
-- (a tabela precisa existir antes do seed).
--
-- Três responsabilidades, TODAS idempotentes (RF-T02 / AC-02):
--   1. Função seed_message_templates(p_tenant_id): insere as 4 chaves com os textos padrão
--      pt-BR, on conflict (tenant_id, template_key) do nothing. security definer + search_path
--      fixo: roda fora do RLS (como as demais funções de signup), insere sob privilégios do
--      owner. Re-chamar para um tenant que já tem as 4 linhas NÃO duplica.
--   2. handle_new_user() recriado com `create or replace` (NÃO editamos a migration aplicada
--      20250216092000 — RNF-T04): corpo atual preservado fielmente + `perform
--      seed_message_templates(v_tenant_id)` após o insert em profiles, no mesmo fluxo atômico
--      do signup. O trigger on_auth_user_created continua válido apontando para esta função
--      (NÃO recriado).
--   3. Backfill idempotente para tenants existentes: cross join tenants × (4 chaves) com
--      on conflict do nothing — tenants legados ganham as 4 linhas ao aplicar; o re-apply
--      (db reset) não duplica.
--
-- Textos padrão pt-BR usam a lista fechada de variáveis da fatia: {nome} {servico} {dataHora}
-- {empresa}. `{valor}` fica FORA (decisão D4 do PRD — depende do módulo Asaas). O lembrete_d1
-- já comporta o texto livre "1 confirmar / 2 reagendar" para PREPARAR a Fatia 2 (confirmação
-- interativa numérica) SEM acoplar webhook/cron/parsing agora (RF-T09 / AC-09).
--
-- A baseline roda via security definer (bypassa RLS) — é a única dona da redação padrão; a UI
-- (ADR-06) nunca inventa o texto inicial. Nenhum segredo no SQL.

-- ============================================================================
-- 1. Função de seed idempotente — insere as 4 chaves padrão para um tenant.
--    security definer + search_path fixo: roda fora do RLS do chamador.
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
     'Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!')
  ) as k(template_key, body)
  on conflict (tenant_id, template_key) do nothing;
end;
$$;

-- ============================================================================
-- 2. handle_new_user() recriado: corpo atual (20250216092000) preservado fielmente +
--    seed dos 4 templates no mesmo fluxo atômico do signup. O trigger on_auth_user_created
--    continua apontando para esta função (NÃO recriado aqui).
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  -- Cria a empresa nova em trial (14 dias — Q1 confirmado pelo humano em prd-approval.json).
  -- legal_name é obrigatório: cai para trade_name, depois para o e-mail, se não vier nada.
  insert into tenants (legal_name, trade_name, owner_email, plan, subscription_status, trial_ends_at)
  values (
    coalesce(
      new.raw_user_meta_data->>'trade_name',
      new.raw_user_meta_data->>'legal_name',
      new.email
    ),
    new.raw_user_meta_data->>'trade_name',
    new.email,
    'individual',
    'trial',
    now() + interval '14 days'
  )
  returning id into v_tenant_id;

  -- Liga o usuário recém-criado ao tenant como admin. O `role` é SEMPRE 'admin' de uma empresa
  -- NOVA; nunca lido do payload do cliente. Convite de membros (professional/receptionist em
  -- tenant existente) não faz parte desta fase.
  insert into profiles (id, tenant_id, role, full_name)
  values (new.id, v_tenant_id, 'admin', new.raw_user_meta_data->>'full_name');

  -- Baseline dos 4 templates da régua no mesmo fluxo atômico do signup (ADR-02): tenant novo
  -- nasce com exatamente 4 linhas, sem janela de tenant sem template. Idempotente.
  perform seed_message_templates(v_tenant_id);

  return new;
end;
$$;

-- ============================================================================
-- 3. Backfill idempotente para tenants existentes — tenants legados ganham as 4 linhas ao
--    aplicar esta migration; o re-apply (db reset) não duplica (on conflict do nothing).
-- ============================================================================
insert into message_templates (tenant_id, template_key, body)
select t.id, k.template_key, k.body
from tenants t
cross join (values
  ('confirmacao',
   'Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}.'),
  ('lembrete_d1',
   'Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
  ('cobranca',
   'Olá {nome}, segue a cobrança do seu {servico} na {empresa}.'),
  ('comprovante',
   'Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!')
) as k(template_key, body)
on conflict (tenant_id, template_key) do nothing;
