-- Migration: default de `tenant_id` nas 4 tabelas operacionais (correção ADR-05)
-- Fecha o defeito confirmado na revisão da ADR-05 (cadastro operacional): os hooks de escrita
-- do cliente NÃO enviam `tenant_id` (regra de isolamento: o cliente nunca manda `tenant_id`),
-- mas as colunas eram `not null` SEM default e SEM trigger. Resultado: todo INSERT chegava com
-- `tenant_id` nulo, o `WITH CHECK (tenant_id = current_tenant_id() …)` reprovava e a escrita era
-- negada por RLS. Em `working_hours` (save = delete + insert em round-trips separados) isso
-- ainda apagava a grade existente.
--
-- Correção no SERVIDOR (nunca enviar `tenant_id` do cliente): o banco preenche `tenant_id` por
-- default com `current_tenant_id()` (helper security definer da fundação, que deriva o tenant do
-- JWT/profiles). Assim o INSERT do cliente — sem `tenant_id` — recebe o tenant correto e o
-- `WITH CHECK` passa para a escrita legítima, enquanto continua barrando cross-tenant (default
-- vem do JWT, não do payload) e cross-professional (policy inalterada).
--
-- Migration NOVA (nunca editar migration aplicada). Idempotente no re-apply
-- (`alter column … set default` é determinístico). Não altera policies nem constraints.
-- `services`, `professionals`, `service_professionals`, `working_hours` já existem
-- (20250217090000_operational_catalog.sql). `current_tenant_id()` já existe
-- (20250216091000_profiles_and_helpers.sql).

alter table services              alter column tenant_id set default current_tenant_id();
alter table professionals         alter column tenant_id set default current_tenant_id();
alter table service_professionals alter column tenant_id set default current_tenant_id();
alter table working_hours         alter column tenant_id set default current_tenant_id();
