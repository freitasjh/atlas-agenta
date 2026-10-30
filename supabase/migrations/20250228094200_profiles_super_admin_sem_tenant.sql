-- Migration: invariante de super admin sem tenant (ADR-06, PRD D-01 / P-05).
-- Um profile com role super_admin não pode ter tenant_id. Se já existir linha violando, o
-- add constraint falha alto. Esta migration não corrige dados sozinha.

alter table profiles
  add constraint profiles_super_admin_sem_tenant
  check (role <> 'super_admin' or tenant_id is null);
