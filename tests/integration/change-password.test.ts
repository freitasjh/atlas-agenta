// Edge Function change-password (ADR-08) e a reserva da troca no banco (RPCs de claim).
// Cobre CA-13 (validação e fluxo feliz), CA-11 (segredos fora das respostas), os critérios 1 a 8
// da ADR-08, a corrida real entre duas requisições e a RLS/grants da reserva para sessão comum.
import { describe, expect, it, afterAll } from "vitest";
import { anonClient, serviceClient, signInWithPassword } from "./helpers/clients.ts";
import { loadEnv } from "./helpers/env.ts";
import { callFunction, type FunctionResponse } from "./helpers/functions.ts";
import {
  createCommonUser,
  createSuperAdminUser,
  deleteTestUsers,
  freshPassword,
  readProfile,
  type TestUser,
} from "./helpers/users.ts";
import { PROVISIONAL_PASSWORD } from "../../supabase/functions/_shared/super-admin-bootstrap.ts";

/** Respostas de todas as chamadas, para checar que nenhum segredo vaza (CA-11). */
const responses: FunctionResponse[] = [];

async function changePassword(password: string, token?: string): Promise<FunctionResponse> {
  const response = await callFunction("change-password", { token, body: { password } });
  responses.push(response);
  return response;
}

/** Confere que a troca recusada (400/409) não mexeu no flag nem na reserva (ADR-08, critério 2). */
async function expectNotMutated(userId: string, flagWasOn: boolean): Promise<void> {
  const profile = await readProfile(userId);
  expect(profile.must_change_password).toBe(flagWasOn);
  expect(profile.password_change_claimed_until).toBeNull();
  expect(profile.password_changed_at).toBeNull();
}

/** `rpc` devolve a linha como array ou objeto, conforme o PostgREST. */
function firstRow(data: unknown): { claim_status?: string; claim_token?: string | null } | undefined {
  return (Array.isArray(data) ? data[0] : data) as
    | { claim_status?: string; claim_token?: string | null }
    | undefined;
}

afterAll(async () => {
  await deleteTestUsers();
});

describe("CA-13 validação e autenticação da troca de senha", () => {
  it("sem JWT responde 401", async () => {
    const response = await callFunction("change-password", {
      body: { password: freshPassword() },
    });
    responses.push(response);
    expect(response.status).toBe(401);
  });

  it("senha com 7 caracteres responde 400 password_too_short", async () => {
    const user = await createSuperAdminUser("cp-short");
    const response = await changePassword("x".repeat(7), user.accessToken);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("password_too_short");
    await expectNotMutated(user.id, true);
  });

  it("senha igual à provisória responde 400 password_is_initial", async () => {
    const user = await createSuperAdminUser("cp-initial");
    const response = await changePassword(PROVISIONAL_PASSWORD, user.accessToken);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("password_is_initial");
    await expectNotMutated(user.id, true);
  });

  it("corpo com campo extra responde 400 invalid_body", async () => {
    const user = await createSuperAdminUser("cp-extra");
    const response = await callFunction("change-password", {
      token: user.accessToken,
      body: { password: freshPassword(), user_id: user.id },
    });
    responses.push(response);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("invalid_body");
    await expectNotMutated(user.id, true);
  });

  it("usuário sem flag responde 409 password_change_not_required", async () => {
    const user = await createCommonUser("cp-noflag");
    const response = await changePassword(freshPassword(), user.accessToken);
    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("password_change_not_required");
    await expectNotMutated(user.id, false);
  });

  it("senha válida responde 200, zera o flag e só a senha nova entra", async () => {
    const user = await createSuperAdminUser("cp-ok");
    const newPassword = freshPassword();

    const response = await changePassword(newPassword, user.accessToken);
    expect(response.status, response.text).toBe(200);
    expect(response.json?.ok).toBe(true);
    expect(response.text).not.toContain(newPassword);

    const profile = await readProfile(user.id);
    expect(profile.must_change_password).toBe(false);
    expect(profile.password_changed_at).not.toBeNull();
    expect(profile.password_change_claimed_until).toBeNull();

    const fresh = await signInWithPassword(user.email, newPassword);
    expect(fresh.userId).toBe(user.id);

    const { error: oldErr } = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    expect(oldErr).not.toBeNull();
  });
});

describe("CA-11 segredos fora das respostas de change-password", () => {
  it("nenhuma resposta contém a senha provisória, a service role nem o marcador", () => {
    const serviceKey = loadEnv().serviceRoleKey;
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(response.text).not.toContain(PROVISIONAL_PASSWORD);
      expect(response.text).not.toContain(serviceKey);
      expect(response.text).not.toContain("bootstrap_role");
    }
  });
});

describe("ADR-08 reserva e corrida entre duas requisições", () => {
  for (let round = 1; round <= 3; round += 1) {
    it(`rodada ${round}: duas trocas simultâneas, uma 200 e uma 409, só a senha de 200 entra`, async () => {
      const user = await createSuperAdminUser(`cp-race-${round}`);
      const passwordA = freshPassword();
      const passwordB = freshPassword();

      // Janela de cada requisição: início antes do envio e fim ao receber a resposta. Se as janelas
      // não se sobrepõem, as chamadas foram serializadas e a rodada não prova a corrida.
      const timed = async (password: string) => {
        const started = performance.now();
        const response = await changePassword(password, user.accessToken);
        return { response, started, ended: performance.now() };
      };
      const [timedA, timedB] = await Promise.all([timed(passwordA), timed(passwordB)]);
      expect(timedA.started < timedB.ended && timedB.started < timedA.ended).toBe(true);

      const a = timedA.response;
      const b = timedB.response;
      const outcomes = [a, b].map((r) => r.status).sort();
      expect(outcomes).toEqual([200, 409]);

      const loser = a.status === 409 ? a : b;
      expect(["password_change_in_progress", "password_change_not_required"]).toContain(
        loser.json?.code,
      );

      const winnerPassword = a.status === 200 ? passwordA : passwordB;
      const loserPassword = a.status === 200 ? passwordB : passwordA;
      await signInWithPassword(user.email, winnerPassword);
      const { error } = await anonClient().auth.signInWithPassword({
        email: user.email,
        password: loserPassword,
      });
      expect(error).not.toBeNull();
    });
  }
});

describe("ADR-08 critérios de reserva via RPC", () => {
  let user: TestUser;
  let firstToken = "";
  let secondToken = "";

  it("reserva tomada, depois in_progress com reserva ativa", async () => {
    user = await createSuperAdminUser("cp-claim");
    const svc = serviceClient();

    const first = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
    expect(first.error).toBeNull();
    expect(firstRow?.claim_status).toBe("claimed");
    expect(firstRow?.claim_token).toBeTruthy();
    firstToken = String(firstRow?.claim_token);

    const second = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
    expect(secondRow?.claim_status).toBe("in_progress");
    expect(secondRow?.claim_token).toBeNull();
  });

  it("reserva expirada é tomada de novo com token novo", async () => {
    const svc = serviceClient();
    const { error: expireErr } = await svc
      .from("profiles")
      .update({ password_change_claimed_until: new Date(Date.now() - 1000).toISOString() })
      .eq("id", user.id);
    expect(expireErr).toBeNull();

    const reclaim = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const row = Array.isArray(reclaim.data) ? reclaim.data[0] : reclaim.data;
    expect(row?.claim_status).toBe("claimed");
    secondToken = String(row?.claim_token);
    expect(new Date(secondToken).getTime()).not.toBe(new Date(firstToken).getTime());
  });

  it("liberação e conclusão com token antigo não mexem na reserva ativa", async () => {
    const svc = serviceClient();
    await svc.rpc("release_password_change_claim", {
      p_user_id: user.id,
      p_claim_token: firstToken,
    });
    const finished = await svc.rpc("finish_password_change", {
      p_user_id: user.id,
      p_claim_token: firstToken,
    });
    expect(finished.data).toBe(false);

    const profile = await readProfile(user.id);
    expect(profile.must_change_password).toBe(true);
    expect(new Date(String(profile.password_change_claimed_until)).getTime()).toBe(
      new Date(secondToken).getTime(),
    );
  });

  it("conclusão com o token da reserva ativa zera o flag e limpa a reserva", async () => {
    const svc = serviceClient();
    const finished = await svc.rpc("finish_password_change", {
      p_user_id: user.id,
      p_claim_token: secondToken,
    });
    expect(finished.data).toBe(true);

    const profile = await readProfile(user.id);
    expect(profile.must_change_password).toBe(false);
    expect(profile.password_change_claimed_until).toBeNull();

    const after = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const row = Array.isArray(after.data) ? after.data[0] : after.data;
    expect(row?.claim_status).toBe("not_required");
    expect(row?.claim_token).toBeNull();
  });
});

describe("ADR-08 sessão comum não mexe na reserva (grants e guard)", () => {
  it("authenticated não executa claim nem release e não altera a reserva", async () => {
    const user = await createSuperAdminUser("cp-grants");

    const claim = await user.client.rpc("claim_password_change", { p_user_id: user.id });
    expect(claim.error?.code).toBe("42501");

    const release = await user.client.rpc("release_password_change_claim", {
      p_user_id: user.id,
      p_claim_token: new Date().toISOString(),
    });
    expect(release.error?.code).toBe("42501");

    const direct = await user.client
      .from("profiles")
      .update({ password_change_claimed_until: new Date(Date.now() + 60_000).toISOString() })
      .eq("id", user.id);
    expect(direct.error?.message ?? "").toContain("privileged_column_change_denied");

    expect((await readProfile(user.id)).password_change_claimed_until).toBeNull();
  });
});

/*
 * Não exercitado pela suíte: o 409 `password_change_superseded` da Edge Function (ADR-08,
 * critério 9, caso B, resposta HTTP). Chegar lá exige forçar falha na RPC de conclusão, o que
 * esta suíte não faz. A sequência de banco do caso B é coberta abaixo. A resposta HTTP fica como
 * risco aberto para o QA, conforme registrado na revisão da ADR-10.
 */
describe("ADR-08 critério 9, caso B: requisição atrasada no banco", () => {
  it("B libera a própria reserva, A conclui com false e o flag segue ligado", async () => {
    const user = await createSuperAdminUser("cp-caso-b");
    const svc = serviceClient();

    const { data: dataA } = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const a = firstRow(dataA);
    expect(a?.claim_status).toBe("claimed");
    const tokenA = String(a?.claim_token);

    // A fica lenta: a reserva expira.
    const { error: expireErr } = await svc
      .from("profiles")
      .update({ password_change_claimed_until: new Date(Date.now() - 1000).toISOString() })
      .eq("id", user.id);
    expect(expireErr).toBeNull();

    // B toma a reserva, grava a senha e falha ao concluir. Libera a própria reserva.
    const { data: dataB } = await svc.rpc("claim_password_change", { p_user_id: user.id });
    const b = firstRow(dataB);
    expect(b?.claim_status).toBe("claimed");
    const tokenB = String(b?.claim_token);
    expect(tokenB).not.toBe(tokenA);
    const released = await svc.rpc("release_password_change_claim", {
      p_user_id: user.id,
      p_claim_token: tokenB,
    });
    expect(released.error).toBeNull();

    // A chega e tenta concluir: superada, então false, flag segue ligado e a reserva segue nula.
    const finishA = await svc.rpc("finish_password_change", {
      p_user_id: user.id,
      p_claim_token: tokenA,
    });
    expect(finishA.error).toBeNull();
    expect(finishA.data).toBe(false);

    const profile = await readProfile(user.id);
    expect(profile.must_change_password).toBe(true);
    expect(profile.password_change_claimed_until).toBeNull();
    expect(profile.password_changed_at).toBeNull();
  });
});
