import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";
import {
  createCommonUser,
  deleteTestUsers,
  type TestUser,
} from "../helpers/users.ts";

let adminA: TestUser;
let adminB: TestUser;

beforeAll(async () => {
  adminA = await createCommonUser("profiles-rls-a");
  adminB = await createCommonUser("profiles-rls-b");
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("IT-01 profile de outro tenant não aparece (ADR-001)", () => {
  it("admin A não vê profile do admin B", async () => {
    const { data, error } = await adminA.client
      .from("profiles")
      .select("id, active, email")
      .eq("id", adminB.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("admin A vê o próprio profile com active=true", async () => {
    const { data, error } = await adminA.client
      .from("profiles")
      .select("id, active")
      .eq("id", adminA.id)
      .single();
    expect(error).toBeNull();
    expect(data?.active).toBe(true);
  });

  it("índice profiles_tenant_id_active_idx existe", () => {
    const count = Number(
      sql(`select count(*) from pg_indexes where schemaname='public' and indexname='profiles_tenant_id_active_idx';`),
    );
    expect(count).toBe(1);
  });
});