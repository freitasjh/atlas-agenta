// Edge Function `change-password` (ADR-04) contra o stack local: RQ-08, RQ-09 e RQ-10 da ADR-13.
//
// RQ-10 pede duas chamadas quase simultâneas. Nesta implementação não há reserva (ADR-12 removeu
// as RPCs de claim) e o GoTrue invalida as sessões ao gravar a senha: cada chamada lê o flag com
// `getUser` e, se o flag ainda estiver ligado, grava. O interleaving não é controlável pelo teste,
// então o que se afirma sobre o par são os INVARIANTES, não o par exato de status:
//   - cada resposta é 200 ou 409 (`password_change_not_required`), nunca erro inesperado;
//   - ao menos uma chamada escreve;
//   - o flag final é `false`;
//   - exatamente uma das duas senhas novas entra (a última escrita vence), e ela é de uma chamada
//     que respondeu 200 — quando as duas respondem 200, a vencedora depende da ordem real de
//     escrita e o teste não a fixa.
// O caso puramente sequencial (200 e depois 409) continua ao lado, esse sim com resultado fixo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, signInWithPassword } from "../helpers/clients.ts";
import { loadEnv } from "../helpers/env.ts";
import { callFunction, type FunctionResponse } from "../helpers/functions.ts";
import { ensureFunctionsDefault } from "../helpers/functions-server.ts";
import {
  clearMustChangePassword,
  createSuperAdminUser,
  deleteTestUsers,
  freshPassword,
  readAuthMetadata,
  type TestUser,
} from "../helpers/users.ts";
import { PROVISIONAL_PASSWORD } from "../../../supabase/functions/_shared/super-admin-bootstrap.ts";

/** Respostas de todas as chamadas, para checar que nenhum segredo vaza (CA-11). */
const responses: FunctionResponse[] = [];

async function changePassword(password: string, token?: string): Promise<FunctionResponse> {
  const response = await callFunction("change-password", { token, body: { password } });
  responses.push(response);
  return response;
}

/** Confere que a recusa não mexeu no flag nem na senha: a senha antiga continua logando. */
async function expectUnchanged(user: TestUser): Promise<void> {
  const metadata = await readAuthMetadata(user.id);
  expect(metadata.must_change_password).toBe(true);
  const session = await signInWithPassword(user.email, user.password);
  expect(session.userId).toBe(user.id);
}

beforeAll(async () => {
  await ensureFunctionsDefault();
});

afterAll(async () => {
  await deleteTestUsers();
});

describe("RQ-09 códigos de recusa e nada muda", () => {
  it("sem JWT válido responde 401 unauthenticated", async () => {
    const response = await changePassword(freshPassword());
    expect(response.status).toBe(401);
    expect(response.json?.code).toBe("unauthenticated");
  });

  it("senha com 7 caracteres responde 400 password_too_short", async () => {
    const user = await createSuperAdminUser("cp-short");
    const response = await changePassword("x".repeat(7), user.accessToken);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("password_too_short");
    await expectUnchanged(user);
  });

  it("senha com mais de 72 bytes responde 400 password_too_long", async () => {
    const user = await createSuperAdminUser("cp-long");
    const response = await changePassword("a".repeat(73), user.accessToken);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("password_too_long");
    await expectUnchanged(user);
  });

  it("senha igual à provisória responde 400 password_is_initial", async () => {
    const user = await createSuperAdminUser("cp-initial");
    const response = await changePassword(PROVISIONAL_PASSWORD, user.accessToken);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("password_is_initial");
    await expectUnchanged(user);
  });

  it("campo extra no corpo responde 400 invalid_body", async () => {
    const user = await createSuperAdminUser("cp-extra");
    const response = await callFunction("change-password", {
      token: user.accessToken,
      body: { password: freshPassword(), user_id: user.id },
    });
    responses.push(response);
    expect(response.status).toBe(400);
    expect(response.json?.code).toBe("invalid_body");
    await expectUnchanged(user);
  });

  it("flag já limpo responde 409 password_change_not_required", async () => {
    const user = await createSuperAdminUser("cp-noflag");
    await clearMustChangePassword(user.id);
    const response = await changePassword(freshPassword(), user.accessToken);
    expect(response.status).toBe(409);
    expect(response.json?.code).toBe("password_change_not_required");
  });
});

describe("RQ-08 troca válida grava a senha e limpa o flag", () => {
  it("login antes funciona, a troca responde 200, a senha nova entra e a antiga sai", async () => {
    const user = await createSuperAdminUser("cp-ok");
    const newPassword = freshPassword();

    // Login antes da troca, com a senha provisória do helper.
    const before = await signInWithPassword(user.email, user.password);
    expect(before.userId).toBe(user.id);

    const response = await changePassword(newPassword, user.accessToken);
    expect(response.status, response.text).toBe(200);
    expect(response.json?.ok).toBe(true);
    expect(response.text).not.toContain(newPassword);

    const metadata = await readAuthMetadata(user.id);
    expect(metadata.must_change_password).toBe(false);
    expect(metadata.provider).toBe("email");
    expect(Array.isArray(metadata.providers) ? metadata.providers : []).toContain("email");

    const after = await signInWithPassword(user.email, newPassword);
    expect(after.userId).toBe(user.id);

    const { error } = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    expect(error).not.toBeNull();
  });
});

describe("RQ-10 última escrita vence, flag final false", () => {
  it("duas chamadas em paralelo: status em {200,409}, flag final false e só uma senha nova entra", async () => {
    const user = await createSuperAdminUser("cp-parallel");
    const firstPassword = freshPassword();
    const secondPassword = freshPassword();

    const [first, second] = await Promise.all([
      changePassword(firstPassword, user.accessToken),
      changePassword(secondPassword, user.accessToken),
    ]);
    const calls = [
      { password: firstPassword, response: first },
      { password: secondPassword, response: second },
    ];

    for (const { password, response } of calls) {
      expect([200, 409], `status ${response.status}: ${response.text}`).toContain(response.status);
      if (response.status === 409) {
        expect(response.json?.code).toBe("password_change_not_required");
      } else {
        expect(response.json?.ok).toBe(true);
        // A resposta de sucesso nunca ecoa a senha enviada (CA-11).
        expect(response.text).not.toContain(password);
      }
    }

    const accepted = calls.filter(({ response }) => response.status === 200);
    expect(accepted.length, "ao menos uma chamada precisa ter gravado").toBeGreaterThanOrEqual(1);

    // Sem reserva e sem lock, o flag final é `false` em qualquer interleaving: quem grava zera.
    expect((await readAuthMetadata(user.id)).must_change_password).toBe(false);

    /** `true` quando a senha autentica; erro que não seja credencial inválida derruba o teste. */
    const logsIn = async (password: string): Promise<boolean> => {
      const { error } = await anonClient().auth.signInWithPassword({ email: user.email, password });
      if (error && error.status !== 400) {
        throw new Error(`Login de verificação falhou com status ${error.status ?? "ausente"}.`);
      }
      return error === null;
    };

    const outcomes: string[] = [];
    for (const { password } of calls) {
      if (await logsIn(password)) outcomes.push(password);
    }

    // Exatamente uma senha nova vale: a da última escrita. Qual das duas depende da ordem real.
    expect(outcomes, "apenas uma das duas senhas novas pode autenticar").toHaveLength(1);
    const winningPassword = outcomes[0];
    if (winningPassword === undefined) throw new Error("Nenhuma senha nova autenticou.");
    expect(accepted.map(({ password }) => password)).toContain(winningPassword);

    // A senha provisória do helper não autentica mais e a senha vencedora abre sessão nova.
    expect(await logsIn(user.password)).toBe(false);
    await signInWithPassword(user.email, winningPassword);
  });

  it("primeira troca 200; segunda chamada com sessão nova encontra o flag limpo e recebe 409", async () => {
    const user = await createSuperAdminUser("cp-second");
    const firstPassword = freshPassword();
    const secondPassword = freshPassword();

    const first = await changePassword(firstPassword, user.accessToken);
    expect(first.status, first.text).toBe(200);

    const secondSession = await signInWithPassword(user.email, firstPassword);
    const second = await changePassword(secondPassword, secondSession.accessToken);
    expect(second.status, second.text).toBe(409);
    expect(second.json?.code).toBe("password_change_not_required");

    expect((await readAuthMetadata(user.id)).must_change_password).toBe(false);

    await signInWithPassword(user.email, firstPassword);
    const { error } = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: secondPassword,
    });
    expect(error).not.toBeNull();
  });
});

describe("CA-11 segredos fora das respostas", () => {
  it("nenhuma resposta contém a senha provisória nem a service role", () => {
    const serviceKey = loadEnv().serviceRoleKey;
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(response.text).not.toContain(PROVISIONAL_PASSWORD);
      expect(response.text).not.toContain(serviceKey);
    }
  });
});
