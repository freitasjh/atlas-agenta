// Script de operador (ADR-07): cria o super admin inicial por SQL direto em auth.users.
// Uso: deno run --allow-env --allow-net scripts/bootstrap-super-admin.ts [--allow-remote]
//
// Mecanismo: a Admin API do GoTrue grava o app_metadata depois do INSERT, então o trigger
// handle_new_user (ADR-06) não vê o marcador bootstrap_role e cria uma empresa. Por isso a linha é
// inserida direto em auth.users, dentro de uma transação, com o marcador já em raw_app_meta_data.
// O trigger então cria só o profile super_admin (sem tenant). A linha de auth.identities também é
// criada, porque o login por senha depende dela. Ver ADR-07, seção Decisão.
//
// Trava de ambiente (RQ-06, P-04): URL de banco que não seja localhost/127.0.0.1 é recusada antes
// de qualquer conexão, a menos que `--allow-remote` seja passado.
// Segredo: SUPABASE_DB_URL só vem do ambiente. Saída: só o status e o id (RQ-13).
import postgres from "npm:postgres@3.4.5";
import { z } from "npm:zod@3.23.8";
import {
  BOOTSTRAP_ROLE_KEY,
  BOOTSTRAP_ROLE_VALUE,
  PROVISIONAL_PASSWORD,
  SUPER_ADMIN_EMAIL,
  decideBootstrapAction,
  type BootstrapAction,
  type BootstrapState,
} from "../supabase/functions/_shared/super-admin-bootstrap.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const ZERO_INSTANCE_ID = "00000000-0000-0000-0000-000000000000";
// Índice único parcial do e-mail em auth.users (GoTrue). Verificado no stack local (ADR-07 rev. 3).
const AUTH_EMAIL_UNIQUE_CONSTRAINT = "users_email_partial_key";

// Linha lida do banco é externa: validada com zod antes de uso.
const profileSchema = z.object({
  role: z.string().nullable(),
  tenant_id: z.string().nullable(),
  must_change_password: z.boolean().nullable(),
});

export function isLocalUrl(rawUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

export function shouldBlockRemote(rawUrl: string, allowRemote: boolean): boolean {
  return !isLocalUrl(rawUrl) && !allowRemote;
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

type Outcome = { status: BootstrapAction; userId: string | null };

// Só a corrida no e-mail de auth.users conta. Outras violações (identities, profiles) são erro.
function isEmailUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505" &&
    "constraint_name" in err && err.constraint_name === AUTH_EMAIL_UNIQUE_CONSTRAINT;
}

// Insere usuário e identidade. O trigger handle_new_user cria o profile na mesma transação.
async function insertSuperAdmin(tx: postgres.TransactionSql): Promise<string> {
  const [created] = await tx<{ id: string }[]>`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, phone_change, phone_change_token,
      email_change_token_current, reauthentication_token
    ) values (
      gen_random_uuid(), ${ZERO_INSTANCE_ID}, 'authenticated', 'authenticated', ${SUPER_ADMIN_EMAIL},
      extensions.crypt(${PROVISIONAL_PASSWORD}, extensions.gen_salt('bf')), now(),
      ${tx.json({ provider: "email", providers: ["email"], [BOOTSTRAP_ROLE_KEY]: BOOTSTRAP_ROLE_VALUE })},
      '{}'::jsonb, false, false, now(), now(),
      '', '', '', '', '', '', '', ''
    )
    returning id`;

  await tx`
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    values (
      gen_random_uuid(), ${created.id}, ${created.id},
      ${tx.json({ sub: created.id, email: SUPER_ADMIN_EMAIL, email_verified: true, phone_verified: false })},
      'email', now(), now()
    )`;

  return created.id;
}

// Decide o status a partir do profile atual do usuário existente. Não altera nada (RQ-05).
async function outcomeForExisting(tx: postgres.TransactionSql, userId: string): Promise<Outcome> {
  const [profileRow] = await tx`
    select role, tenant_id, must_change_password from profiles where id = ${userId}`;
  const profile = profileRow ? profileSchema.parse(profileRow) : null;
  const state: BootstrapState = {
    exists: true,
    profileRole: profile?.role ?? null,
    tenantId: profile?.tenant_id ?? null,
  };
  return { status: decideBootstrapAction(state), userId };
}

// Roda dentro de uma transação. Qualquer exceção desfaz a inserção (inclusive usuário e identidade).
async function bootstrap(tx: postgres.TransactionSql): Promise<Outcome> {
  const [existing] = await tx<{ id: string }[]>`
    select id from auth.users where lower(email) = lower(${SUPER_ADMIN_EMAIL}) limit 1 for update`;

  if (existing) {
    return outcomeForExisting(tx, existing.id);
  }

  let createdId: string;
  try {
    // Savepoint: se a inserção bater no índice único, só ela é desfeita e a transação segue válida.
    createdId = await tx.savepoint((sp) => insertSuperAdmin(sp));
  } catch (err) {
    if (!isEmailUniqueViolation(err)) throw err;
    // Outra execução criou o super admin entre a leitura e o insert. Depois do commit dela, a
    // releitura enxerga o usuário e o resultado é ja_existe.
    const [raced] = await tx<{ id: string }[]>`
      select id from auth.users where lower(email) = lower(${SUPER_ADMIN_EMAIL}) limit 1`;
    if (!raced) throw err;
    return outcomeForExisting(tx, raced.id);
  }

  // Confere o profile criado pelo trigger antes de commitar.
  const [profileRow] = await tx`
    select role, tenant_id, must_change_password from profiles where id = ${createdId}`;
  const profile = profileRow ? profileSchema.parse(profileRow) : null;
  const ok = profile !== null &&
    profile.role === "super_admin" &&
    profile.tenant_id === null &&
    profile.must_change_password === true;
  if (!ok) {
    throw new Error("perfil fora do esperado");
  }
  return { status: "criado", userId: createdId };
}

async function main(): Promise<void> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    fail("Defina SUPABASE_DB_URL no ambiente antes de executar.");
  }

  const allowRemote = Deno.args.includes("--allow-remote");
  if (shouldBlockRemote(dbUrl, allowRemote)) {
    fail("Banco não local. Para executar contra um ambiente remoto, passe --allow-remote.");
  }

  // TLS obrigatório fora do localhost (RNF/LGPD: credencial e senha não trafegam em claro).
  // Não depende de `sslmode` estar na URL. `require` criptografa, mas não valida o certificado.
  const sql = postgres(dbUrl, {
    max: 1,
    onnotice: () => {},
    ssl: isLocalUrl(dbUrl) ? false : "require",
  });
  let outcome: Outcome;
  try {
    outcome = await sql.begin((tx) => bootstrap(tx));
  } catch {
    // Mensagem genérica: não ecoa detalhes do banco, que podem conter PII ou segredo.
    fail("Não foi possível criar o super admin. Nada foi gravado. Verifique o ambiente e tente de novo.");
  } finally {
    await sql.end();
  }

  if (outcome.status === "recusa_papel") {
    fail("Este e-mail já existe com outro papel. Resolva manualmente antes de criar o super admin.");
  }
  if (outcome.userId === null) {
    fail("Estado inesperado ao localizar o super admin.");
  }
  console.log(`status: ${outcome.status}`);
  console.log(`id: ${outcome.userId}`);
}

if (import.meta.main) {
  await main();
}
