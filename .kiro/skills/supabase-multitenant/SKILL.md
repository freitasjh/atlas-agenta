---
name: supabase-multitenant
description: Modelar schema Postgres, escrever migrations e políticas RLS para o isolamento multi-tenant por tenant_id no Supabase. Use ao criar/alterar tabelas, políticas de segurança, ou ao configurar Auth/profiles e papéis RBAC.
---

# Supabase Multi-Tenant (schema, migrations, RLS)

Guia para modelar dados com isolamento rígido por `tenant_id` no Supabase/Postgres.

## Princípios

1. **Toda tabela de domínio tem `tenant_id uuid not null` + índice + RLS habilitado.**
2. O `tenant_id` do usuário vem de `profiles`, não de input do cliente.
3. Service role só em Edge Functions. O cliente usa anon key + sessão (RLS protege).

## Base: profiles + função de tenant

```sql
-- profiles liga auth.users ao tenant e ao papel
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade, -- null para super_admin
  role text not null check (role in ('super_admin','admin','professional','receptionist')),
  professional_id uuid,                 -- liga a um professionals quando aplicável
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;

-- tenant_id do usuário atual (SECURITY DEFINER para ler profiles sem recursão de RLS)
create or replace function current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = auth.uid()
$$;

create or replace function current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
```

## Padrão de RLS por tabela de tenant

```sql
alter table appointments enable row level security;

-- leitura: mesma empresa
create policy appointments_select on appointments for select
  using (tenant_id = current_tenant_id());

-- escrita: mesma empresa (admin/recepção/profissional conforme regra de app)
create policy appointments_write on appointments for all
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());
```

### RBAC refinado (exemplos)
- **professional** vê só a própria agenda:
  ```sql
  create policy appt_prof_select on appointments for select
    using (tenant_id = current_tenant_id()
      and (current_role_name() <> 'professional'
           or professional_id = (select professional_id from profiles where id = auth.uid())));
  ```
- **receptionist sem financeiro:** não criar policy de SELECT para `receptionist` em `charges`.
  Só `admin` lê `charges`:
  ```sql
  create policy charges_admin_only on charges for select
    using (tenant_id = current_tenant_id() and current_role_name() = 'admin');
  ```

### Super admin cross-tenant
Nunca via cliente. Acesso cross-tenant só por Edge Function com service role, ou policy
explícita:
```sql
create policy tenants_super_admin on tenants for all
  using (current_role_name() = 'super_admin');
```

## Prevenção de conflito de horário (RF06)

```sql
create extension if not exists btree_gist;
alter table appointments
  add constraint no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado','nao_compareceu'));
```

## Checklist antes de concluir uma migration

- [ ] `tenant_id` presente + índice.
- [ ] RLS habilitado e políticas select/insert/update/delete cobertas.
- [ ] Testado que um usuário de outro tenant NÃO lê a linha.
- [ ] Dinheiro em `*_cents`, tempo em `timestamptz`.
- [ ] Migration versionada em `supabase/migrations` com nome descritivo e timestamp.
- [ ] Nenhum segredo no SQL.

## Armadilhas

- Recursão de RLS ao ler `profiles` dentro de policy → usar função `security definer`.
- Esquecer `with check` em políticas de escrita permite inserir linha de outro tenant.
- Confiar em `tenant_id` enviado pelo cliente. Sempre derivar de `current_tenant_id()`.
