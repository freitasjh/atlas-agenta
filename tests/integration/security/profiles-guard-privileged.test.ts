import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";
import {
  createCommonUser,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let user: TestUser;

beforeAll(async () => {
  user = await createCommonUser("profiles-guard");
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("IT-02 guard de colunas privilegiadas em profiles (ADR-001)", () => {
  it("sessão authenticated não altera active", () => {
    let thrown: unknown;
    try {
      sql(
        `begin;
         select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
         update public.profiles set active = not active where id = :'profile_id'::uuid;
         rollback;`,
        { profile_id: user.id },
      );
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("privileged_column_change_denied");
  });

  it("sessão authenticated não altera email", () => {
    let thrown: unknown;
    try {
      sql(
        `begin;
         select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
         update public.profiles set email = 'x@example.invalid' where id = :'profile_id'::uuid;
         rollback;`,
        { profile_id: user.id },
      );
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("privileged_column_change_denied");
  });

  it("sessão authenticated altera full_name", () => {
    expect(() =>
      sql(
        `begin;
         select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
         update public.profiles set full_name = full_name where id = :'profile_id'::uuid;
         rollback;`,
        { profile_id: user.id },
      ),
    ).not.toThrow();
  });

  it("sessão service role altera active", () => {
    expect(() =>
      sql(
        `begin;
         select set_config('request.jwt.claims', '{"role":"service_role"}', true);
         update public.profiles set active = not active where id = :'profile_id'::uuid;
         rollback;`,
        { profile_id: user.id },
      ),
    ).not.toThrow();
  });

  const privilegedCases: Array<{ name: string; stmt: string }> = [
    { name: "id", stmt: `update public.profiles set id = gen_random_uuid() where id = :'profile_id'::uuid;` },
    { name: "role", stmt: `update public.profiles set role = 'professional' where id = :'profile_id'::uuid;` },
    { name: "tenant_id", stmt: `update public.profiles set tenant_id = gen_random_uuid() where id = :'profile_id'::uuid;` },
    { name: "deactivated_at", stmt: `update public.profiles set deactivated_at = now() where id = :'profile_id'::uuid;` },
    { name: "deactivated_by", stmt: `update public.profiles set deactivated_by = :'profile_id'::uuid where id = :'profile_id'::uuid;` },
    { name: "role_changed_at", stmt: `update public.profiles set role_changed_at = now() where id = :'profile_id'::uuid;` },
    { name: "role_changed_by", stmt: `update public.profiles set role_changed_by = :'profile_id'::uuid where id = :'profile_id'::uuid;` },
  ];

  for (const c of privilegedCases) {
    it(`sessão authenticated não altera ${c.name}`, () => {
      let thrown: unknown;
      try {
        sql(
          `begin;
           select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
           ${c.stmt}
           rollback;`,
          { profile_id: user.id },
        );
      } catch (err) {
        thrown = err;
      }
      expect(String(thrown)).toContain("privileged_column_change_denied");
    });
  }
});