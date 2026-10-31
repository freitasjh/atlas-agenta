// Script de operador scripts/bootstrap-super-admin.ts (ADR-07). Roda o script de verdade via Deno
// contra o banco local. Cobre CA-07, CA-08, CA-10 e CA-11.
//
// CA-09 (recusa de usuário existente com papel de tenant) não roda aqui: exigiria mudar o papel
// de admin@neox.com.br, que esta suíte não altera. A decisão pura (`decideBootstrapAction`) já
// cobre o caso nos testes unitários do script (`npm run test:scripts`).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "./helpers/env.ts";
import { sql } from "./helpers/sql.ts";
import { PROVISIONAL_PASSWORD, SUPER_ADMIN_EMAIL } from "../../supabase/functions/_shared/super-admin-bootstrap.ts";

const SCRIPT = fileURLToPath(new URL("../../scripts/bootstrap-super-admin.ts", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface ScriptRun {
  status: number | null;
  output: string;
  durationMs: number;
}

/**
 * Executa o script com ambiente mínimo: só a URL do banco e o que o Deno precisa para rodar.
 * Chaves de API não entram no ambiente do script.
 */
function runScript(dbUrl: string, extraArgs: string[] = []): ScriptRun {
  const started = Date.now();
  // Binário do Deno: `DENO_BIN` se definido, senão `deno` do PATH.
  const denoBin = process.env.DENO_BIN ?? "deno";
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    SUPABASE_DB_URL: dbUrl,
  };
  if (process.env.DENO_DIR) childEnv.DENO_DIR = process.env.DENO_DIR;
  const result = spawnSync(
    denoBin,
    ["run", "--allow-env", "--allow-net", "--allow-read", SCRIPT, ...extraArgs],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000, env: childEnv },
  );
  if (result.error) {
    throw new Error(
      "Não foi possível executar o Deno. Instale o Deno ou defina DENO_BIN com o caminho do binário.",
    );
  }
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    durationMs: Date.now() - started,
  };
}

function parseOutcome(output: string): { status: string; id: string } {
  const status = /^status:\s*(\S+)/m.exec(output)?.[1] ?? "";
  const id = /^id:\s*(\S+)/m.exec(output)?.[1] ?? "";
  return { status, id };
}

const dbUrl = loadEnv().dbUrl;

describe("CA-07 e CA-08 script cria e é idempotente", () => {
  let first: ScriptRun;
  let second: ScriptRun;
  let tenantsBefore = 0;

  beforeAll(() => {
    first = runScript(dbUrl);
    second = runScript(dbUrl);
    tenantsBefore = Number(sql("select count(*) from public.tenants;"));
  });

  it("primeira execução termina com código 0 e status criado ou ja_existe", () => {
    expect(first.status, first.output).toBe(0);
    expect(["criado", "ja_existe"]).toContain(parseOutcome(first.output).status);
  });

  it("segunda execução retorna ja_existe com o mesmo id", () => {
    expect(second.status, second.output).toBe(0);
    expect(parseOutcome(second.output).status).toBe("ja_existe");
    expect(parseOutcome(second.output).id).toBe(parseOutcome(first.output).id);
  });

  it("existe um único usuário, um profile super_admin sem tenant e uma identidade", () => {
    const id = parseOutcome(second.output).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      Number(sql("select count(*) from auth.users where lower(email) = lower(:'email');", {
        email: SUPER_ADMIN_EMAIL,
      })),
    ).toBe(1);
    expect(
      sql("select role || '|' || coalesce(tenant_id::text, 'null') from public.profiles where id = :'uid';", {
        uid: id,
      }),
    ).toBe("super_admin|null");
    expect(
      Number(sql("select count(*) from auth.identities where user_id = :'uid';", { uid: id })),
    ).toBe(1);
  });

  it("o número de empresas não muda entre as execuções", () => {
    expect(Number(sql("select count(*) from public.tenants;"))).toBe(tenantsBefore);
  });
});

describe("CA-10 URL remota sem flag sai antes de conectar", () => {
  it("sai com erro sem tentar a rede e sem ecoar a senha da URL", () => {
    const secret = randomUUID();
    const remote = `postgresql://operador:${secret}@db.example.invalid:5432/postgres`;
    const run = runScript(remote);

    expect(run.status).not.toBe(0);
    expect(run.durationMs).toBeLessThan(10_000);
    expect(run.output).not.toContain(secret);
  });
});

describe("CA-11 segredos fora da saída do script", () => {
  it("saída não contém a senha provisória, a URL do banco nem o marcador", () => {
    const run = runScript(dbUrl);
    expect(run.output).not.toContain(PROVISIONAL_PASSWORD);
    expect(run.output).not.toContain(dbUrl);
    expect(run.output).not.toContain("bootstrap_role");
  });
});

// Pendente: exige alterar o papel de admin@neox.com.br, que esta suíte não altera. Ver o
// comentário no topo do arquivo.
it.skip("CA-09 recusa usuário existente com papel de tenant (pendente, ver comentário do arquivo)", () => {});
