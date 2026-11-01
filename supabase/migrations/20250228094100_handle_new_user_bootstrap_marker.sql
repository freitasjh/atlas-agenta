-- Migration: handle_new_user reconhece o marcador de bootstrap do super admin (ADR-06).
-- O marcador vem SOMENTE de raw_app_meta_data, campo gravado pelo servidor via Admin API
-- (service role). signUp e updateUser do cliente gravam raw_user_meta_data, que o próprio usuário
-- edita; por isso ele nunca é lido aqui.
--
-- Com o marcador 'super_admin': cria só o profile da plataforma (role super_admin, tenant_id
-- nulo, troca de senha obrigatória). Não cria tenant nem message_templates.
-- Sem o marcador: corpo idêntico ao da 20250225091000 (cadastro comum inalterado).
-- O trigger on_auth_user_created não é recriado: já aponta para esta função.
-- Nenhum valor do marcador, e-mail ou senha vai para log ou exceção.

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
  -- Super admin da plataforma: marcador escrito só pelo servidor. Nenhum tenant é criado.
  if coalesce(new.raw_app_meta_data, '{}'::jsonb) ->> 'bootstrap_role' = 'super_admin' then
    insert into profiles (id, tenant_id, role, full_name, must_change_password)
    values (new.id, null, 'super_admin', null, true);
    return new;
  end if;

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
