-- Infra: bucket privado `clinical-media` (ADR-05 — fotos antes/depois,
-- mapa facial e termo de consentimento). Conta como infra, não migration de
-- domínio: nenhum schema de negócio muda; só o contêiner privado do Storage.
--
-- Layout de objetos (sem `tenant_id` no path — o tenant vem do JWT):
--   <customer_id>/<appointment_id>/fotos/<tipo>-<aaaammdd>-<hhmmss>-<rand>.jpg
--   <customer_id>/<appointment_id>/mapa-facial.json
--   <customer_id>/termo-consentimento.json
--
-- Isolamento: o 1º segmento é sempre o `customers.id`, cujo `tenant_id` é
-- comparado com `current_tenant_id()`. Caminhos de atendimento exigem ainda o
-- mesmo vínculo clínico de `clinical_records` (admin do tenant ou professional
-- ativo responsável pelo atendimento). Recepção não entra em nenhum ramo:
-- zero linhas, sem request sensível vazando.
--
-- Append-only no nível do Storage: SÓ policies de SELECT e INSERT, mais uma
-- policy estreita de UPDATE SÓ para `*/mapa-facial.json` (edição livre do
-- mapa). Sem policy de DELETE em nenhum caminho; fotos (`fotos/*`) e termo
-- (`termo-consentimento.json`) seguem imutáveis — nenhuma policy de UPDATE
-- os alcança.
--
-- Idempotência: `on conflict do nothing` no bucket + `drop policy if exists`
-- antes de cada `create policy`. Nenhum segredo no SQL.

insert into storage.buckets (id, name, public)
values ('clinical-media', 'clinical-media', false)
on conflict (id) do nothing;

grant select, insert, update on storage.objects to authenticated;

-- ============================================================================
-- SELECT: leitura clínica do próprio tenant.
-- ============================================================================
drop policy if exists "clinical-media select" on storage.objects;
create policy "clinical-media select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'clinical-media'
    and (storage.foldername(name))[1] in (
      select c.id::text from customers c
      where c.tenant_id = current_tenant_id()
    )
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and (
          -- termo (2 segmentos): qualquer professional ativo do tenant lê.
          array_length(storage.foldername(name), 1) = 1
          and exists (
            select 1 from professionals p
            where p.tenant_id = current_tenant_id()
              and p.profile_id = auth.uid()
              and p.active = true
          )
        )
        or (
          -- atendimento (3+ segmentos): vínculo com o atendimento.
          array_length(storage.foldername(name), 1) >= 2
          and (storage.foldername(name))[2] in (
            select a.id::text from appointments a
            where a.tenant_id = current_tenant_id()
              and a.professional_id in (
                select p.id from professionals p
                where p.tenant_id = current_tenant_id()
                  and p.profile_id = auth.uid()
                  and p.active = true
              )
          )
        )
      )
    )
  );

-- ============================================================================
-- INSERT: escrita clínica do próprio tenant (fotos + termo + 1º mapa).
-- ============================================================================
drop policy if exists "clinical-media insert" on storage.objects;
create policy "clinical-media insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'clinical-media'
    and (storage.foldername(name))[1] in (
      select c.id::text from customers c
      where c.tenant_id = current_tenant_id()
    )
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and (
          array_length(storage.foldername(name), 1) = 1
          and exists (
            select 1 from professionals p
            where p.tenant_id = current_tenant_id()
              and p.profile_id = auth.uid()
              and p.active = true
          )
        )
        or (
          array_length(storage.foldername(name), 1) >= 2
          and (storage.foldername(name))[2] in (
            select a.id::text from appointments a
            where a.tenant_id = current_tenant_id()
              and a.professional_id in (
                select p.id from professionals p
                where p.tenant_id = current_tenant_id()
                  and p.profile_id = auth.uid()
                  and p.active = true
              )
          )
        )
      )
    )
  );

-- ============================================================================
-- UPDATE: reescrita SÓ do mapa facial (`*/mapa-facial.json`), com o mesmo
-- vínculo tenant/clínico do SELECT. Fotos e termo seguem sem UPDATE: o
-- Storage nega por padrão o que nenhuma policy permite.
-- ============================================================================
drop policy if exists "clinical-media update mapa" on storage.objects;
create policy "clinical-media update mapa" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'clinical-media'
    and storage.filename(name) = 'mapa-facial.json'
    and (storage.foldername(name))[1] in (
      select c.id::text from customers c
      where c.tenant_id = current_tenant_id()
    )
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and (storage.foldername(name))[2] in (
          select a.id::text from appointments a
          where a.tenant_id = current_tenant_id()
            and a.professional_id in (
              select p.id from professionals p
              where p.tenant_id = current_tenant_id()
                and p.profile_id = auth.uid()
                and p.active = true
            )
        )
      )
    )
  )
  with check (
    bucket_id = 'clinical-media'
    and storage.filename(name) = 'mapa-facial.json'
    and (storage.foldername(name))[1] in (
      select c.id::text from customers c
      where c.tenant_id = current_tenant_id()
    )
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and (storage.foldername(name))[2] in (
          select a.id::text from appointments a
          where a.tenant_id = current_tenant_id()
            and a.professional_id in (
              select p.id from professionals p
              where p.tenant_id = current_tenant_id()
                and p.profile_id = auth.uid()
                and p.active = true
            )
        )
      )
    )
  );
