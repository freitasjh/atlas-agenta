// RPC complete_password_change(p_user_id) (ADR-05): zera o flag só pela service role.
// Cobre o contrato de execução: sessão autenticada e anon não executam; service role executa e
// a segunda chamada devolve false.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient } from "./helpers/clients.ts";
import {
  createSuperAdminUser,
  deleteTestUsers,
  readProfile,
  type TestUser,
} from "./helpers/users.ts";

let user: TestUser;

beforeAll(async () => {
  user = await createSuperAdminUser("rpc-complete");
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("complete_password_change (ADR-05)", () => {
  it("sessão autenticada não executa a RPC e o flag não muda", async () => {
    const { error } = await user.client.rpc("complete_password_change", { p_user_id: user.id });
    expect(error).not.toBeNull();
    expect((await readProfile(user.id)).must_change_password).toBe(true);
  });

  it("anon não executa a RPC e o flag não muda", async () => {
    const { error } = await anonClient().rpc("complete_password_change", { p_user_id: user.id });
    expect(error).not.toBeNull();
    expect((await readProfile(user.id)).must_change_password).toBe(true);
  });

  it("service role zera o flag e grava password_changed_at", async () => {
    const { data, error } = await serviceClient().rpc("complete_password_change", {
      p_user_id: user.id,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);

    const profile = await readProfile(user.id);
    expect(profile.must_change_password).toBe(false);
    expect(profile.password_changed_at).not.toBeNull();
  });

  it("segunda chamada com o flag já zerado devolve false", async () => {
    const { data } = await serviceClient().rpc("complete_password_change", {
      p_user_id: user.id,
    });
    expect(data).toBe(false);
  });
});
