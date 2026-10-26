-- Migration: seed_message_templates com variante por ramo + handle_new_user() lendo segment
--            — ADR-02 Fase 1a (ramo/segmento).
--
-- O signup atômico de hoje (20250222091000_message_templates_baseline.sql) cria, numa única
-- transação security definer: tenant trial 14d + profile admin + seed_message_templates() com
-- os 4 templates genéricos (confirmacao, lembrete_d1, cobranca, comprovante). A Fase 1a precisa
-- persistir o ramo escolhido no cadastro (tenants.segment) e seedar a redação pt-BR do ramo,
-- mantendo a invariante "nenhum tenant sem os templates da régua" (RF-03..RF-05 / RF-S03,
-- RF-S04). A régua tem 5 chaves desde a 20250223093000 (confirmacao, lembrete_d1, cobranca,
-- comprovante, reagendar_retorno) — este seed por ramo cobre TODAS as 5 (a 5ª com texto do ramo).
--
-- Decisão D3 do gate (travada): os TEMPLATES continuam seedados NO TRIGGER (agora com variante
-- de ramo), preservando atomicidade; o CATÁLOGO de services NÃO vai para o trigger (fica
-- client-side, ADR-06). O segmento vem do cliente apenas como METADADO de signup
-- (raw_user_meta_data->>'segment'), validado pelo servidor; NUNCA é chave de isolamento.
--
-- Depende da ADR-01 (20250225090000): o check em tenants.segment deve existir antes de o trigger
-- gravar o ramo. Ordenação de timestamp 20250225090000 < 20250225091000.
--
-- Fronteiras (prd.md §4 / analysis-data.md §6):
--   * RLS inalterada — nenhuma tabela nova; security definer + search_path fixos preservados.
--   * Signup atômico intocado — apenas lê+valida+grava segment e escolhe o conjunto de textos.
--   * Invariante dos 4 templates mantida; nenhum catálogo pesado no trigger.
--   * Segment inválido NÃO aborta o signup: é normalizado para NULL (cai no genérico).
--   * Migration nova e idempotente; NÃO edita migration aplicada; NÃO recria o trigger
--     on_auth_user_created (continua apontando para handle_new_user).
--   * Textos usam a lista fechada {nome} {servico} {dataHora} {empresa} (sem {valor}),
--     coerente com src/lib/message-templates.ts. Nenhum segredo no SQL.

-- ============================================================================
-- 1. seed_message_templates(p_tenant_id, p_segment): insere as 5 chaves da régua para um tenant
--    (confirmacao, lembrete_d1, cobranca, comprovante, reagendar_retorno — a 5ª introduzida pela
--    20250223093000), escolhendo a redação pt-BR conforme o ramo. Fallback genérico (cópia fiel
--    da 20250222091000 + 20250223093000) quando p_segment é NULL/desconhecido. security definer +
--    search_path fixo: roda fora do RLS.
--
--    Adicionar o parâmetro com default null MUDA a assinatura; como o Postgres identifica função
--    por assinatura, descartamos a forma antiga de 1 argumento antes de recriar, para não deixar
--    duas versões coexistindo. Únicos chamadores: handle_new_user e o backfill da 20250222091000
--    (este já aplicado, não re-executado).
-- ============================================================================
drop function if exists seed_message_templates(uuid);

create or replace function seed_message_templates(p_tenant_id uuid, p_segment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into message_templates (tenant_id, template_key, body)
  select p_tenant_id, k.template_key, k.body
  from (
    -- Variante do ramo: projeta só (template_key, body) para casar o arity do UNION ALL abaixo.
    select seg.template_key, seg.body
    from (values
      ('barbearia', 'confirmacao',
       'Fala {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}. Te espero!'),
      ('barbearia', 'lembrete_d1',
       'E aí {nome}, amanhã tem {servico} na {empresa} às {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
      ('barbearia', 'cobranca',
       'Fala {nome}, segue a cobrança do seu {servico} na {empresa}.'),
      ('barbearia', 'comprovante',
       'Pagamento confirmado, {nome}! Valeu por escolher a {empresa}. Até a próxima!'),
      ('barbearia', 'reagendar_retorno',
       'Fala {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Já já a gente te chama pra marcar um novo horário.'),

      ('clinica', 'confirmacao',
       'Olá {nome}, sua consulta de {servico} na {empresa} está agendada para {dataHora}.'),
      ('clinica', 'lembrete_d1',
       'Olá {nome}, lembrete da sua consulta de {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
      ('clinica', 'cobranca',
       'Olá {nome}, segue a cobrança referente à sua consulta de {servico} na {empresa}.'),
      ('clinica', 'comprovante',
       'Recebemos o pagamento da sua consulta de {servico} na {empresa}. Obrigado, {nome}! Cuide-se.'),
      ('clinica', 'reagendar_retorno',
       'Olá {nome}, recebemos seu pedido de reagendamento da consulta de {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.'),

      ('salao', 'confirmacao',
       'Oi {nome}! Seu horário de {servico} na {empresa} está confirmado para {dataHora}.'),
      ('salao', 'lembrete_d1',
       'Oi {nome}, amanhã é o seu {servico} na {empresa} às {dataHora}. Responda 1 para confirmar ou 2 para reagendar.'),
      ('salao', 'cobranca',
       'Oi {nome}, segue a cobrança do seu {servico} na {empresa}.'),
      ('salao', 'comprovante',
       'Pagamento recebido, {nome}! Obrigada por escolher a {empresa}. Até breve!'),
      ('salao', 'reagendar_retorno',
       'Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}. Em breve entramos em contato para encontrar um novo horário.')
    ) as seg(segment, template_key, body)
    where seg.segment = p_segment

    union all

    -- Fallback genérico: textos idênticos aos da 20250222091000 (NÃO regredir). Usados quando
    -- p_segment é NULL/desconhecido, ou seja, quando o ramo não casa com nenhuma variante acima.
    select gen.template_key, gen.body
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
    ) as gen(template_key, body)
    where not exists (
      select 1
      from (values ('barbearia'), ('clinica'), ('salao')) as known(segment)
      where known.segment = p_segment
    )
  ) as k(template_key, body)
  on conflict (tenant_id, template_key) do nothing;
end;
$$;

-- ============================================================================
-- 2. handle_new_user() recriado com create or replace. Corpo atual (20250222091000) preservado
--    fielmente; duas mudanças mínimas: (a) ler/validar/normalizar o segment do metadata de
--    signup; (b) gravar segment em tenants e repassar ao seed. O trigger on_auth_user_created
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
  v_segment text;
begin
  -- Ramo escolhido no cadastro chega como METADADO de signup (nunca como chave de isolamento).
  -- Normaliza vazio → NULL e descarta valor fora do enum, para um segmento inválido NÃO abortar
  -- o signup pelo check de tenants.segment: grava NULL e cai no seed genérico (RF-04).
  v_segment := nullif(new.raw_user_meta_data->>'segment', '');
  if v_segment is not null and v_segment not in ('barbearia', 'clinica', 'salao') then
    v_segment := null;
  end if;

  -- Cria a empresa nova em trial (14 dias — Q1 confirmado pelo humano em prd-approval.json).
  -- legal_name é obrigatório: cai para trade_name, depois para o e-mail, se não vier nada.
  insert into tenants (legal_name, trade_name, owner_email, plan, subscription_status, trial_ends_at, segment)
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
    now() + interval '14 days',
    v_segment
  )
  returning id into v_tenant_id;

  -- Liga o usuário recém-criado ao tenant como admin. O `role` é SEMPRE 'admin' de uma empresa
  -- NOVA; nunca lido do payload do cliente. Convite de membros (professional/receptionist em
  -- tenant existente) não faz parte desta fase.
  insert into profiles (id, tenant_id, role, full_name)
  values (new.id, v_tenant_id, 'admin', new.raw_user_meta_data->>'full_name');

  -- Baseline das 5 chaves da régua no mesmo fluxo atômico do signup, agora com a variante do
  -- ramo (fallback genérico quando v_segment é NULL). Tenant novo nasce com exatamente 5 linhas,
  -- sem janela de tenant sem template. Idempotente.
  perform seed_message_templates(v_tenant_id, v_segment);

  return new;
end;
$$;

-- Backfill: NÃO reescrever templates de legados. Eles já têm os 4 textos genéricos e segment NULL;
-- reescrever template de legado violaria RF-07. A 20250222091000 já garantiu os 4 por tenant.
