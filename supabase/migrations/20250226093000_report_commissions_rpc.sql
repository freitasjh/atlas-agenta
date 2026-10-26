-- Migration: RPC report_commissions — relatório de comissão por período (ADR-04 Fase 1b)
-- O relatório (RF-C5 / prd.md §3.1) agrega a comissão por profissional num intervalo de datas, em
-- BRL. Somar linha-a-linha no cliente violaria a disciplina do projeto (RNF01) e o teto do
-- PostgREST — a agregação acontece SEMPRE NO BANCO. Esta migration só CRIA a função de leitura;
-- não cria tabela nem coluna nova, não altera policy. Depende de appointment_commissions (ADR-02,
-- 20250226091000) como fonte; só devolve valores depois que o trigger da ADR-03
-- (20250226092000) começa a gravar snapshots.
--
-- PADRÃO: SECURITY INVOKER + GRANT a authenticated, idêntico às RPCs do dashboard
-- (20250224090000_dashboard_agenda_rpcs.sql; nota brain rpc-security-invoker-pattern). A função
-- roda sob o RLS do CHAMADOR e HERDA a policy de SELECT de appointment_commissions (ADR-02):
--   F1 — isolamento multi-tenant: tenant_id vem do JWT via current_tenant_id() na policy, NUNCA de
--        parâmetro; a RPC não reimplementa predicado de tenant, herda do RLS (AC-04.4 / AC-6).
--   F2 — RBAC financeiro: admin agrega tudo do tenant; professional agrega SÓ as próprias linhas
--        (a policy recorta por professionals.profile_id = auth.uid()); receptionist NÃO recebe
--        linha alguma (sem policy de SELECT em appointment_commissions) — AC-04.3 / AC-7 / AC-8.
--   F6 — SECURITY DEFINER é PROIBIDO aqui: rodaria elevado e furaria o RLS (cross-tenant), vazando
--        comissão de outro tenant e quebrando o sigilo financeiro do receptionist.
-- GRANT EXECUTE TO authenticated + REVOKE ALL FROM anon, public: a função é chamada com anon key +
-- sessão do usuário; o RLS é a fronteira. Nenhum segredo (service role/Asaas/Evolution) no SQL.
--
-- p_professional_id (opcional): quando não-nulo, filtra ac.professional_id = p_professional_id. NÃO
-- é fronteira de segurança — o RLS já recorta o professional (F2); é conveniência de UI / defesa em
-- profundidade (um admin filtrar um barbeiro). Mesmo espírito do dashboard_agenda_overview.
--
-- FUSO 100% NO CLIENTE: a função é "burra" quanto a fuso — recebe instantes timestamptz UTC
-- absolutos (bordas do período já derivadas no cliente a partir de tenants.timezone, padrão das
-- RPCs do dashboard) e só compara contra elas. Janela semiaberta [p_start, p_end). Eixo temporal =
-- calculated_at (instante da apuração = conclusão — prd.md §7 D-7). NUNCA date_trunc nem aritmética
-- de fuso em SQL.
--
-- DINHEIRO: soma em centavos INTEIRO; sum(commission_cents) em bigint para evitar overflow na
-- agregação; nunca float. O cliente só formata total_commission_cents com formatCentsToBRL.
--
-- Idempotente no re-apply (create or replace function); não edita migration já aplicada. Timestamp
-- posterior ao último existente da fatia (20250226092000).

-- ============================================================================
-- report_commissions — total de comissão por profissional em [p_start, p_end), eixo calculated_at.
-- Uma linha por profissional com comissão no período. Cobre RF-C5 / AC-04.1..04.4 / AC-10.
-- Join a professionals para o nome; o RLS de professionals (herdado) confina ao tenant. O
-- predicado de tenant/papel NÃO é reimplementado aqui — vem da policy de SELECT de
-- appointment_commissions (ADR-02).
-- ============================================================================
create or replace function public.report_commissions(
  p_start           timestamptz,
  p_end             timestamptz,
  p_professional_id uuid default null
)
returns table (
  professional_id        uuid,
  professional_name      text,
  total_commission_cents bigint,
  appointment_count      bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    ac.professional_id,
    p.name                       as professional_name,
    sum(ac.commission_cents)::bigint as total_commission_cents,
    count(*)::bigint             as appointment_count
  from public.appointment_commissions ac
  join public.professionals p
    on p.tenant_id = ac.tenant_id
   and p.id = ac.professional_id
  where ac.calculated_at >= p_start
    and ac.calculated_at <  p_end
    and (p_professional_id is null or ac.professional_id = p_professional_id)
  group by ac.professional_id, p.name
  order by p.name asc;
$$;

comment on function public.report_commissions(timestamptz, timestamptz, uuid) is
  'Relatorio de comissao por periodo (ADR-04 Fase 1b, RF-C5): soma commission_cents e conta os '
  'snapshots de appointment_commissions com calculated_at em [p_start,p_end), agregado por '
  'profissional (nome via join a professionals), em centavos inteiro (bigint). Eixo calculated_at '
  '(D-7); bordas do periodo derivadas no cliente no fuso do tenant. p_professional_id e '
  'conveniencia de UI, nao fronteira. SECURITY INVOKER: herda o RLS de appointment_commissions — '
  'admin ve tudo do tenant, professional so a propria linha, receptionist nenhuma (isolamento e '
  'RBAC por construcao).';

grant execute on function public.report_commissions(timestamptz, timestamptz, uuid) to authenticated;
revoke all on function public.report_commissions(timestamptz, timestamptz, uuid) from anon;
revoke all on function public.report_commissions(timestamptz, timestamptz, uuid) from public;
