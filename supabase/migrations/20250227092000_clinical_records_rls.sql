-- Migration: clinical_records — policies RLS de leitura e inserção (ADR-06)
--
-- Continua a ADR-05 (schema, constraints e trigger de validação, sem policy). Aqui entram:
--   - grants: authenticated recebe SOMENTE select e insert. A RLS filtra as linhas. Sem UPDATE,
--     DELETE e TRUNCATE. anon segue sem nenhum privilégio (a ADR-05 revogou tudo).
--   - policy de SELECT: admin lê todo o tenant; professional lê só registros de atendimentos em
--     que é o profissional responsável (professionals.profile_id = auth.uid()); recepção e
--     super_admin não entram em nenhum ramo, então recebem zero linhas.
--   - policy de INSERT (WITH CHECK): mesmo predicado de vínculo, mais:
--       * created_by = auth.uid() e created_at = now() (o default já grava now(); a app não envia
--         created_at, e um valor forjado é recusado);
--       * atendimento com status em_atendimento ou concluido (PRD D-02);
--       * tenant com subscription_status fora de bloqueado e cancelado (PRD D-08, aplicado no banco).
--   - correção usa a MESMA policy de insert. A FK composta da ADR-05 garante que a correção aponta
--     para o mesmo atendimento e o mesmo cliente do original.
--   - nenhuma policy de UPDATE ou DELETE: o registro é append-only (PRD D-01).
--
-- Sem security definer. As subqueries rodam sob a RLS do próprio chamador, inclusive a de
-- appointments e a de professionals. O predicado repete o filtro por profissional em vez de confiar
-- só nelas, para a regra ficar explícita e não depender de outra policy.
--
-- Isolamento: o tenant vem de current_tenant_id() (JWT/profiles), nunca do cliente. Segmento
-- (tenants.segment) não aparece em nenhuma cláusula: é só gating de UI (PRD D-04).
--
-- Idempotência: `drop policy if exists` antes de cada `create policy`. `grant` é idempotente.
-- Nenhum segredo no SQL. Nenhuma migration anterior é editada.

-- ============================================================================
-- Grants: só select e insert para authenticated. anon continua sem privilégio.
-- ============================================================================
grant select, insert on table clinical_records to authenticated;

-- ============================================================================
-- SELECT: leitura pelo vínculo do atendimento (PRD §5, D-03, D-06, D-07).
-- ============================================================================
drop policy if exists clinical_records_select on clinical_records;
create policy clinical_records_select on clinical_records for select
  using (
    tenant_id = current_tenant_id()
    and appointment_id in (
      select a.id from appointments a
      where a.tenant_id = current_tenant_id()
        and (
          current_role_name() = 'admin'
          or (
            current_role_name() = 'professional'
            and a.professional_id in (
              select p.id from professionals p
              where p.tenant_id = current_tenant_id()
                and p.profile_id = auth.uid()
            )
          )
        )
    )
  );

-- ============================================================================
-- INSERT: registro original ou correção, no atendimento do próprio vínculo, com status e
-- assinatura permitidos (PRD RF-01, RF-02, RF-10). Sem UPDATE e sem DELETE.
-- ============================================================================
drop policy if exists clinical_records_insert on clinical_records;
create policy clinical_records_insert on clinical_records for insert
  with check (
    tenant_id = current_tenant_id()
    and created_by = auth.uid()
    and created_at = now()
    and appointment_id in (
      select a.id from appointments a
      where a.tenant_id = current_tenant_id()
        and (
          current_role_name() = 'admin'
          or (
            current_role_name() = 'professional'
            and a.professional_id in (
              select p.id from professionals p
              where p.tenant_id = current_tenant_id()
                and p.profile_id = auth.uid()
            )
          )
        )
    )
    and exists (
      select 1 from appointments a
      where a.id = clinical_records.appointment_id
        and a.tenant_id = current_tenant_id()
        and a.status in ('em_atendimento', 'concluido')
    )
    and exists (
      select 1 from tenants t
      where t.id = current_tenant_id()
        and t.subscription_status not in ('bloqueado', 'cancelado')
    )
  );
