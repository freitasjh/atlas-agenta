import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";

describe("IT-03 backfill de email em profiles (ADR-001)", () => {
  it("re-executar o backfill não falha (idempotente)", () => {
    expect(() =>
      sql(
        `update public.profiles p
            set email = u.email
           from auth.users u
          where p.id = u.id
            and p.email is null;`,
      ),
    ).not.toThrow();
    expect(() =>
      sql(
        `update public.profiles p
            set email = u.email
           from auth.users u
          where p.id = u.id
            and p.email is null;`,
      ),
    ).not.toThrow();
  });

  it("helper current_user_is_active existe", () => {
    const count = Number(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='current_user_is_active';`),
    );
    expect(count).toBe(1);
  });

  it("invitations.professional_id existe (nullable)", () => {
    const nullable = sql(
      `select is_nullable from information_schema.columns where table_schema='public' and table_name='invitations' and column_name='professional_id';`,
    );
    expect(nullable).toBe("YES");
  });

  it("professionals.profile_id FK composta por tenant existe", () => {
    const count = Number(
      sql(`select count(*) from pg_constraint where conname='professionals_profile_tenant_fk';`),
    );
    expect(count).toBe(1);
  });

  it("invitations.professional_id FK composta por tenant existe", () => {
    const count = Number(
      sql(`select count(*) from pg_constraint where conname='invitations_professional_tenant_fk';`),
    );
    expect(count).toBe(1);
  });

  it("invitations_professional_id_idx existe", () => {
    const count = Number(
      sql(`select count(*) from pg_indexes where indexname='invitations_professional_id_idx';`),
    );
    expect(count).toBe(1);
  });

  it("backfill de email popula profiles.email a partir de auth.users", () => {
    const id = randomUUID();
    const email = `backfill-${randomUUID()}@example.invalid`;
    // Profile de empresa (admin + tenant) em vez de super_admin: o trigger
    // `freeze_super_admin_role` bloqueia novos super_admin quando já existe operador interno
    // (a seed cria um). O backfill de e-mail independe do papel; usar admin mantém a regra intacta.
    const query = `begin;
      insert into auth.users (id, email, is_sso_user, is_anonymous) values (:'id'::uuid, :'email', false, false);
      with new_tenant as (
        insert into public.tenants (legal_name, owner_email) values ('Backfill Teste', :'email') returning id
      )
      insert into public.profiles (id, tenant_id, role, email)
      select :'id'::uuid, t.id, 'admin', null from new_tenant t;
      update public.profiles set email = null where id = :'id'::uuid;
      update public.profiles p set email = u.email from auth.users u where p.id = u.id and p.email is null;
      select email from public.profiles where id = :'id'::uuid;
      rollback;`;
    const got = sql(query, { id, email });
    expect(got).toBe(email);
  });
});
