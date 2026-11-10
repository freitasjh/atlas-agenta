import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, signInWithPassword } from "./clients.ts";

/** Usuário de teste criado e apagado por um caso. */
export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  accessToken: string;
}

/** Usuários e empresas criados, para a limpeza no afterAll de cada arquivo. */
const createdUsers: string[] = [];
const createdTenants = new Set<string>();

/** Registra um usuário criado fora dos helpers (ex.: Edge Function de cadastro) para a limpeza. */
export function trackUser(userId: string): void {
  createdUsers.push(userId);
}

/** Registra uma empresa criada fora do helper para a limpeza. */
export function trackTenant(tenantId: string): void {
  createdTenants.add(tenantId);
}

/**
 * Gera uma senha única por chamada. Não há literal de senha no código. A senha não passa de
 * 40 bytes, então fica dentro do limite de 72 bytes da troca.
 */
export function freshPassword(): string {
  return `Aa1!${randomUUID()}`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.invalid`;
}

function tradeName(): string {
  return `Empresa Teste ${randomUUID().slice(0, 8)}`;
}

async function createAuthUser(
  email: string,
  password: string,
  appMetadata?: Record<string, unknown>,
  track = true,
): Promise<string> {
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  });
  if (error || !data.user) {
    throw new Error(`Criação de usuário de teste falhou (status ${error?.status ?? "sem status"}).`);
  }
  if (track) createdUsers.push(data.user.id);
  return data.user.id;
}

/** Gera um CPF válido e único por chamada (base aleatória + DVs calculados). */
function validCpfSeed(): string {
  let base = "";
  for (let i = 0; i < 9; i += 1) base += Math.floor(Math.random() * 10).toString();
  if (/^([0-9])\1*$/.test(base)) base = "234567891";
  const digit = (s: string, weight: number): number => {
    let sum = 0;
    for (let i = 0; i < s.length; i += 1) sum += Number(s[i]) * (weight - i);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = digit(base, 10);
  const d2 = digit(`${base}${d1}`, 11);
  return `${base}${d1}${d2}`;
}

async function createTenantWithAdmin(userId: string, email: string, track = true): Promise<string> {
  const { data, error } = await serviceClient().rpc("create_tenant_with_admin", {
    p_user_id: userId,
    p_owner_email: email,
    p_trade_name: tradeName(),
    p_full_name: "Usuário Teste",
    p_segment: null,
    p_legal_name: null,
    p_document: validCpfSeed(),
    p_phone: "11987654321",
    p_cep: "01310100",
    p_street: "Avenida Paulista",
    p_number: "1000",
    p_complement: null,
    p_city: "Sao Paulo",
    p_state: "SP",
  });
  if (error || typeof data !== "string") {
    throw new Error(`Criação da empresa de teste falhou (código ${error?.code ?? "sem código"}).`);
  }
  if (track) createdTenants.add(data);
  return data;
}

/**
 * Cria um admin de empresa pelo mesmo caminho do cadastro (RPC `create_tenant_with_admin`,
 * ADR-02) e faz login. O trigger de `auth.users` não existe mais, então a empresa, o profile e
 * os 5 templates nascem na RPC com service role.
 */
export async function createCommonUser(prefix = "common"): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const id = await createAuthUser(email, password);
  try {
    await createTenantWithAdmin(id, email);
  } catch (err) {
    await serviceClient().auth.admin.deleteUser(id);
    createdUsers.pop();
    throw err;
  }
  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/** Cria um admin de empresa com e-mail fixo. Usado no caso de 409 do bootstrap. */
export async function createCommonUserWithEmail(
  email: string,
  options: { track?: boolean } = {},
): Promise<TestUser> {
  const track = options.track ?? true;
  const password = freshPassword();
  const id = await createAuthUser(email, password, undefined, track);
  try {
    await createTenantWithAdmin(id, email, track);
  } catch (err) {
    await serviceClient().auth.admin.deleteUser(id);
    if (track) createdUsers.pop();
    throw err;
  }
  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/**
 * Cria um super admin de teste pela Admin API: `createUser` com
 * `app_metadata.must_change_password = true` e `INSERT` do profile `super_admin` sem tenant
 * (ADR-05, pendência resolvida na ADR-13). Não usa `bootstrap_role` nem o trigger removido.
 */
export async function createSuperAdminUser(prefix = "superadmin"): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const id = await createAuthUser(email, password, { must_change_password: true });

  const { error } = await serviceClient().from("profiles").insert({
    id,
    tenant_id: null,
    role: "super_admin",
  });
  if (error) {
    await serviceClient().auth.admin.deleteUser(id);
    createdUsers.pop();
    throw new Error(`Insert do profile de super admin falhou (código ${error.code ?? "sem código"}).`);
  }

  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/**
 * Cria um usuário Auth com profile de empresa em um papel escolhido (ADR-13, RQ-13).
 * O dono da empresa nasce pelo cadastro (`createCommonUser`); os demais papéis entram aqui,
 * com `INSERT` pela service role, como faria um convite server-side.
 */
export async function createTenantMember(
  tenantId: string,
  role: "admin" | "professional" | "receptionist",
  prefix: string,
): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const id = await createAuthUser(email, password);

  const { error } = await serviceClient().from("profiles").insert({
    id,
    tenant_id: tenantId,
    role,
  });
  if (error) {
    await serviceClient().auth.admin.deleteUser(id);
    createdUsers.pop();
    throw new Error(`Insert do profile ${role} falhou (código ${error.code ?? "sem código"}).`);
  }

  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/** Cria um usuário no Auth sem profile (o trigger não existe mais, então basta o `createUser`). */
export async function createAuthUserWithoutProfile(prefix = "orphan"): Promise<string> {
  const session = await createAuthUserWithoutProfileSession(prefix);
  return session.id;
}

/** Usuário Auth sem profile com e-mail fixo. Usado no caso 409 `usuario_sem_profile` do bootstrap. */
export async function createAuthUserWithoutProfileWithEmail(
  email: string,
  options: { track?: boolean } = {},
): Promise<string> {
  return createAuthUser(email, freshPassword(), undefined, options.track ?? true);
}

/** Usuário sem profile já com sessão: o hook precisa responder claims nulas no login. */
export async function createAuthUserWithoutProfileSession(prefix = "orphan"): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const id = await createAuthUser(email, password);
  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/** Lê o profile pela service role. Sem RLS, para checar o estado real do banco. */
export async function readProfile(userId: string): Promise<{
  role: string;
  tenant_id: string | null;
  full_name: string | null;
}> {
  const { data, error } = await serviceClient()
    .from("profiles")
    .select("role, tenant_id, full_name")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Leitura de profile falhou (código ${error?.code ?? "vazio"}).`);
  return data;
}

/** Lê `app_metadata` pela Admin API (fonte do flag de troca obrigatória desde a ADR-04). */
export async function readAuthMetadata(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient().auth.admin.getUserById(userId);
  if (error || !data.user) {
    throw new Error(`Leitura do usuário Auth falhou (status ${error?.status ?? "sem status"}).`);
  }
  const metadata = data.user.app_metadata;
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

/** Liga ou desliga o flag de troca de senha preservando o restante de `app_metadata`. */
export async function setMustChangePassword(userId: string, value: boolean): Promise<void> {
  const current = await readAuthMetadata(userId);
  const { error } = await serviceClient().auth.admin.updateUserById(userId, {
    app_metadata: { ...current, must_change_password: value },
  });
  if (error) throw new Error(`Atualização do flag falhou (status ${error.status ?? "sem status"}).`);
}

/** Limpa o flag, como faria a Edge Function `change-password` após a troca. */
export async function clearMustChangePassword(userId: string): Promise<void> {
  await setMustChangePassword(userId, false);
}

/** Procura um usuário Auth pelo e-mail, paginando a Admin API. `null` quando não existe. */
export async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const admin = serviceClient();
  const target = email.toLowerCase();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Listagem de usuários falhou (status ${error.status ?? "sem status"}).`);
    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
    if (match) return { id: match.id };
    if (data.users.length < 100 || data.nextPage === null) return null;
  }
  return null;
}

/** Apaga um usuário Auth pelo e-mail e a empresa dele se ficar órfã. Usado no bootstrap. */
export async function deleteAuthUserByEmail(email: string): Promise<void> {
  const found = await findAuthUserByEmail(email);
  if (!found) return;
  const admin = serviceClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("id", found.id)
    .maybeSingle();
  const tenantId = profile?.tenant_id ?? null;
  // `internal_operators.user_id` referencia `auth.users` sem cascade: o operador interno (ex.:
  // super admin criado pelo bootstrap) precisa sair antes do usuário, senão a FK barra a exclusão.
  const { error: operatorError } = await admin
    .from("internal_operators")
    .delete()
    .eq("user_id", found.id);
  if (operatorError) {
    throw new Error(`Limpeza do operador interno falhou (código ${operatorError.code ?? "sem código"}).`);
  }
  const { error } = await admin.auth.admin.deleteUser(found.id);
  if (error) throw new Error(`Limpeza de usuário falhou (status ${error.status ?? "sem status"}).`);
  if (tenantId) await deleteTenantIfEmpty(tenantId);
}

async function deleteTenantIfEmpty(tenantId: string): Promise<void> {
  const admin = serviceClient();
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`Contagem de profiles da empresa falhou (código ${error.code ?? "sem código"}).`);
  if (count === 0) {
    const { error: tenantError } = await admin.from("tenants").delete().eq("id", tenantId);
    if (tenantError) {
      throw new Error(`Limpeza da empresa falhou (código ${tenantError.code ?? "sem código"}).`);
    }
  }
}

/** Apaga os usuários de teste e as empresas que ficarem sem profile. */
export async function deleteTestUsers(): Promise<void> {
  const admin = serviceClient();
  const tenants = new Set(createdTenants);
  createdTenants.clear();

  while (createdUsers.length > 0) {
    const id = createdUsers.pop();
    if (!id) continue;
    const { data: profile, error: readError } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) {
      throw new Error(`Leitura do profile de teste falhou (código ${readError.code ?? "sem código"}).`);
    }
    if (profile?.tenant_id) tenants.add(profile.tenant_id);

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      throw new Error(`Limpeza do usuário de teste falhou (status ${error.status ?? "sem status"}).`);
    }
  }

  for (const tenantId of tenants) {
    await deleteTenantIfEmpty(tenantId);
  }
}

/** Empresa do usuário (criada pela RPC no cadastro). */
export async function tenantIdOf(userId: string): Promise<string> {
  const profile = await readProfile(userId);
  if (!profile.tenant_id) throw new Error("Usuário de teste sem tenant.");
  return profile.tenant_id;
}
