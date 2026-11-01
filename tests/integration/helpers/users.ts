import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, signInWithPassword } from "./clients.ts";
import { sql } from "./sql.ts";

/** Usuário de teste criado e apagado por um caso. */
export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
  accessToken: string;
}

/** Lista de usuários criados, para a limpeza no afterAll de cada arquivo. */
const created: string[] = [];

/** Registra um usuário criado fora dos helpers (ex.: signUp do cliente) para a limpeza. */
export function trackUser(userId: string): void {
  created.push(userId);
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

/**
 * Cria um usuário comum pelo caminho do GoTrue (Admin API, sem marcador). O trigger
 * `handle_new_user` cria a empresa `trial` com profile `admin` (CA-02).
 */
export async function createCommonUser(prefix = "common"): Promise<TestUser> {
  const admin = serviceClient();
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Criação de usuário de teste falhou: ${error?.message ?? "sem usuário"}`);
  }
  created.push(data.user.id);
  const session = await signInWithPassword(email, password);
  return { id: data.user.id, email, password, ...session };
}

/**
 * Cria um super admin de teste com o mesmo INSERT que o script de operador usa (ADR-07). O
 * marcador `bootstrap_role` vai em `raw_app_meta_data` dentro do INSERT, então o trigger cria o
 * profile `super_admin` sem tenant e com troca de senha pendente. Não usa a Admin API, porque o
 * GoTrue grava o app_metadata depois do INSERT e o trigger não o veria (ADR-07, P-12).
 */
export async function createSuperAdminUser(prefix = "superadmin"): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = freshPassword();
  const id = sql(
    `with new_user as (
       insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous,
         created_at, updated_at, confirmation_token, recovery_token,
         email_change_token_new, email_change, phone_change, phone_change_token,
         email_change_token_current, reauthentication_token
       ) values (
         gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         :'email', extensions.crypt(:'password', extensions.gen_salt('bf')), now(),
         jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                            'bootstrap_role', 'super_admin'),
         '{}'::jsonb, false, false, now(), now(),
         '', '', '', '', '', '', '', ''
       )
       returning id, email
     ), ident as (
       insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
       select gen_random_uuid(), new_user.id::text, new_user.id,
              jsonb_build_object('sub', new_user.id::text, 'email', new_user.email, 'email_verified', true),
              'email', now(), now()
         from new_user
       returning user_id
     )
     select id from new_user;`,
    { email, password },
  );
  created.push(id);
  const session = await signInWithPassword(email, password);
  return { id, email, password, ...session };
}

/** Lê o profile pela service role. Sem RLS, para checar o estado real do banco. */
export async function readProfile(userId: string): Promise<{
  role: string;
  tenant_id: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
  password_change_claimed_until: string | null;
}> {
  const { data, error } = await serviceClient()
    .from("profiles")
    .select("role, tenant_id, must_change_password, password_changed_at, password_change_claimed_until")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Leitura de profile falhou: ${error?.message ?? "vazio"}`);
  return data;
}

/** Liga ou desliga o flag de troca de senha pela service role. Só para preparar cenários. */
export async function setMustChangePassword(userId: string, value: boolean): Promise<void> {
  const { error } = await serviceClient()
    .from("profiles")
    .update({ must_change_password: value })
    .eq("id", userId);
  if (error) throw new Error(`Atualização de flag falhou: ${error.message}`);
}

/** Conclui a troca pela RPC da ADR-05 (service role), como faria o fluxo de troca. */
export async function completePasswordChange(userId: string): Promise<void> {
  const { error } = await serviceClient().rpc("complete_password_change", { p_user_id: userId });
  if (error) throw new Error(`complete_password_change falhou: ${error.message}`);
}

/**
 * Apaga o usuário de auth (o profile cai em cascata) e, se nenhum outro profile usar a empresa, a
 * empresa criada pelo trigger para esse usuário. A empresa é lida antes de apagar o usuário, porque
 * depois disso o profile não existe mais.
 */
export async function deleteTestUsers(): Promise<void> {
  const admin = serviceClient();
  while (created.length > 0) {
    const id = created.pop();
    if (!id) continue;
    const { data: profile, error: readError } = await admin
      .from("profiles")
      .select("tenant_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(`Leitura do profile de teste falhou: ${readError.message}`);
    const tenantId = profile?.tenant_id ?? null;

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`Limpeza do usuário de teste falhou: ${error.message}`);

    if (tenantId) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      if (countError) throw new Error(`Contagem de profiles da empresa falhou: ${countError.message}`);
      if (count === 0) {
        const { error: tenantError } = await admin.from("tenants").delete().eq("id", tenantId);
        if (tenantError) throw new Error(`Limpeza da empresa de teste falhou: ${tenantError.message}`);
      }
    }
  }
}

/**
 * Cria um auth user sem profile. Cria um usuário comum (o trigger gera profile e empresa), e depois
 * apaga o profile e a empresa pela service role. O usuário de auth fica para a limpeza do afterAll.
 * Serve para montar uma linha de insert que passe na FK para auth.users.
 */
export async function createAuthUserWithoutProfile(prefix = "orphan"): Promise<string> {
  const user = await createCommonUser(prefix);
  const tenantId = await tenantIdOf(user.id);
  const svc = serviceClient();
  const { error: profileError } = await svc.from("profiles").delete().eq("id", user.id);
  if (profileError) throw new Error(`Remoção do profile de teste falhou: ${profileError.message}`);
  const { error: tenantError } = await svc.from("tenants").delete().eq("id", tenantId);
  if (tenantError) throw new Error(`Remoção da empresa de teste falhou: ${tenantError.message}`);
  return user.id;
}

/** Empresa do usuário comum (tenant criado pelo trigger no cadastro). */
export async function tenantIdOf(userId: string): Promise<string> {
  const profile = await readProfile(userId);
  if (!profile.tenant_id) throw new Error("Usuário de teste sem tenant.");
  return profile.tenant_id;
}
