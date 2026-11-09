// Handler da Edge Function `bootstrap-super-admin` — ADR-05 (super admin inicial, idempotente).
//
// A lógica vive aqui, recebendo o client Supabase por injeção, para os testes rodarem com um fake
// sem subir servidor. `index.ts` só lê o ambiente, cria o client com a service role e chama
// `Deno.serve`.
//
// Ordem rígida, nenhum efeito antes dos passos anteriores:
//   1. `BOOTSTRAP_SECRET` ausente no ambiente → 404, para QUALQUER método (a função parece não
//      existir; não revelar a rota nem pelo 405);
//   2. `OPTIONS` → 200 (preflight) e método diferente de `POST` → 405;
//   3. autenticidade: header `x-bootstrap-secret` comparado em tempo constante com o segredo
//      (schemas.ts). Segredo ausente ou diferente → 401;
//   4. trava de ambiente (P-05): fora de `ATLAS_ENV=local` sem `BOOTSTRAP_ALLOW_NON_LOCAL=true`
//      → 403, mesmo com o segredo certo;
//   5. decisão pelo estado atual e execução do fluxo.
//
// Fluxo:
//   1. busca o usuário pelo e-mail, paginando a Admin API;
//   2. sem usuário: cria o usuário (`email_confirm`, senha provisória, `app_metadata` com o flag de
//      troca) e insere o profile `super_admin` sem tenant com a service role. Se o insert do profile
//      falhar, remove SÓ o usuário recém-criado e responde 500;
//   3. usuário com profile `super_admin` e `tenant_id` nulo: 200 `ja_existe`, sem tocar em senha,
//      flag ou dados;
//   4. usuário com outro papel: 409 `email_com_outro_papel`. Nada muda. Usuário no Auth sem
//      profile: 409 `usuario_sem_profile`, com mensagem de recuperação — NÃO é a mesma situação de
//      um admin de empresa e não pode ser confundido com ela;
//   5. corrida de `createUser` (e-mail já existe): refaz a decisão uma única vez, sem laço. Se o
//      profile ainda não estiver lá, a criação está em andamento: 409 `bootstrap_em_andamento` (não
//      prometer `ja_existe` quando não é).
//
// Garantias: nenhum `delete` em `tenants`; nenhum profile de empresa é convertido; a service role
// fica só no env desta função; logs sem senha, e-mail e id.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  decideBootstrapAction,
  PROVISIONAL_PASSWORD,
  SUPER_ADMIN_EMAIL,
  type BootstrapAction,
} from "../_shared/super-admin-bootstrap.ts";
import {
  authorizeBootstrapRequest,
  BOOTSTRAP_SECRET_HEADER,
  parseBootstrapProfile,
  type BootstrapAccess,
  type BootstrapProfile,
} from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    `authorization, x-client-info, apikey, content-type, ${BOOTSTRAP_SECRET_HEADER}`,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "nao_autorizado"
  | "ambiente_nao_local"
  | "email_com_outro_papel"
  | "usuario_sem_profile"
  | "bootstrap_em_andamento"
  | "bootstrap_bloqueado"
  | "internal_error";

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  nao_autorizado: 401,
  ambiente_nao_local: 403,
  email_com_outro_papel: 409,
  usuario_sem_profile: 409,
  bootstrap_em_andamento: 409,
  bootstrap_bloqueado: 403,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  nao_autorizado: "Não autorizado.",
  ambiente_nao_local: "Bootstrap bloqueado fora do ambiente local.",
  email_com_outro_papel: "Este e-mail já tem cadastro com outro papel.",
  usuario_sem_profile:
    "Este usuário existe no Auth sem profile. Remova o usuário pela Admin API e repita o bootstrap.",
  bootstrap_em_andamento:
    "A criação do super admin está em andamento em outra chamada. Aguarde alguns segundos e tente novamente.",
  bootstrap_bloqueado:
    "Novos super admins estão bloqueados. Operadores internos já existem.",
  internal_error: "Não foi possível criar o super admin. Tente novamente.",
};

/** Resposta de erro padronizada `{ code, message }`, com status do código. */
function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Sem `BOOTSTRAP_SECRET`, a função responde como se não existisse: 404 sem corpo. */
function notFoundResponse(): Response {
  return new Response(null, { status: 404, headers: corsHeaders });
}

/** Resposta de sucesso: `status` (`criado` ou `ja_existe`) e o id do super admin. */
function okResponse(status: BootstrapAction, userId: string): Response {
  return new Response(JSON.stringify({ status, user_id: userId }), {
    status: status === "criado" ? 201 : 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Traduz a negação de acesso em resposta. Switch exaustivo: um código novo sem caso não compila. */
function accessResponse(access: Extract<BootstrapAccess, { ok: false }>): Response {
  switch (access.code) {
    case "nao_encontrado":
      return notFoundResponse();
    case "nao_autorizado":
      return errorResponse("nao_autorizado");
    case "ambiente_nao_local":
      return errorResponse("ambiente_nao_local");
    default: {
      const unreachable: never = access.code;
      return unreachable;
    }
  }
}

/** Tamanho de página da Admin API. A função pagina até achar o e-mail ou a última página. */
const USERS_PAGE_SIZE = 100;
/** Trava de laço: defende contra resposta de paginação inválida do servidor. */
const MAX_USER_PAGES = 100;

/**
 * E-mail já existente no Auth. O GoTrue devolve `email_exists` (ou `user_already_exists`), e
 * versões antigas só informam o texto do erro com status 422.
 */
function isEmailAlreadyRegistered(error: {
  code?: string;
  status?: number;
  message?: string;
}): boolean {
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return error.status === 422 && /already/i.test(error.message ?? "");
}

/** Busca o usuário pelo e-mail, paginando a Admin API. `null` quando não existe. */
async function findUserByEmail(
  service: SupabaseClient,
  email: string,
): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });
    if (error) {
      console.error("bootstrap-super-admin: listUsers failed", error.status ?? "no-status");
      throw new Error("listUsers falhou");
    }
    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
    if (match) return { id: match.id };
    if (data.users.length < USERS_PAGE_SIZE || data.nextPage === null) return null;
  }
  console.error("bootstrap-super-admin: paginação de usuários excedeu o limite");
  throw new Error("paginação de usuários excedeu o limite");
}

/** Lê o profile do usuário. `null` = usuário no Auth sem profile; erro = falha de leitura. */
async function readProfile(
  service: SupabaseClient,
  userId: string,
): Promise<BootstrapProfile | null> {
  const { data, error } = await service
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("bootstrap-super-admin: profile read failed", error.code ?? "no-code");
    throw new Error("leitura de profile falhou");
  }
  if (data === null) return null;

  const profile = parseBootstrapProfile(data);
  if (!profile) {
    console.error("bootstrap-super-admin: profile com formato inesperado");
    throw new Error("profile com formato inesperado");
  }
  return profile;
}

/** Resultado da decisão já com o contexto que a resposta precisa. */
type BootstrapDecision =
  | { kind: "criado" }
  | { kind: "ja_existe"; userId: string }
  | { kind: "recusa_papel" }
  | { kind: "sem_profile" };

/**
 * Aplica `decideBootstrapAction` ao estado atual. Usuário sem profile é um caso próprio: não é
 * admin de empresa e não pode receber o mesmo código de recusa.
 */
async function decideForUser(
  service: SupabaseClient,
  user: { id: string } | null,
): Promise<BootstrapDecision> {
  if (!user) return { kind: "criado" };

  const profile = await readProfile(service, user.id);
  if (profile === null) return { kind: "sem_profile" };

  const action = decideBootstrapAction({
    exists: true,
    profileRole: profile.role,
    tenantId: profile.tenantId,
  });
  if (action === "ja_existe") return { kind: "ja_existe", userId: user.id };
  return { kind: "recusa_papel" };
}

/**
 * Corrida de `createUser`: o e-mail já existe. Uma única nova decisão, sem laço. Profile ainda
 * ausente significa criação em andamento, nunca `ja_existe`.
 */
async function resolveRace(service: SupabaseClient): Promise<Response> {
  const raced = await findUserByEmail(service, SUPER_ADMIN_EMAIL);
  if (!raced) return errorResponse("bootstrap_em_andamento");

  const decision = await decideForUser(service, raced);
  switch (decision.kind) {
    case "ja_existe":
      return okResponse("ja_existe", decision.userId);
    case "sem_profile":
      return errorResponse("bootstrap_em_andamento");
    case "recusa_papel":
      return errorResponse("email_com_outro_papel");
    case "criado":
      // Inalcançável: `raced` existe. Mantém a decisão explícita para o switch exaustivo.
      return errorResponse("bootstrap_em_andamento");
  }
}

/** Cria o usuário e o profile `super_admin` sem tenant. Remove só o usuário criado se o profile falhar. */
async function createSuperAdmin(service: SupabaseClient): Promise<Response> {
  const { data, error } = await service.auth.admin.createUser({
    email: SUPER_ADMIN_EMAIL,
    password: PROVISIONAL_PASSWORD,
    email_confirm: true,
    // O hook custom_access_token (ADR-01) lê este metadado; usuário não o edita (app_metadata).
    // A ADR-04 é quem zera o flag, na mesma chamada em que grava a senha nova.
    app_metadata: { must_change_password: true },
  });

  if (error) {
    if (!isEmailAlreadyRegistered(error)) {
      console.error("bootstrap-super-admin: createUser failed", error.status ?? "no-status");
      return errorResponse("internal_error");
    }
    return resolveRace(service);
  }

  if (!data.user) {
    console.error("bootstrap-super-admin: createUser returned no user");
    return errorResponse("internal_error");
  }
  const userId = data.user.id;

  // O trigger de auth.users foi removido (ADR-02), então o profile nasce aqui, com service role.
  // A troca obrigatória vive em `app_metadata.must_change_password` (gravado acima); as colunas
  // antigas de `profiles` foram removidas na ADR-12.
  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    tenant_id: null,
    role: "super_admin",
  });
  if (profileError) {
    console.error("bootstrap-super-admin: profile insert failed", profileError.code ?? "no-code");
    // Rollback do que esta chamada criou: o usuário Auth. Nenhum tenant existe para apagar.
    const { error: deleteError } = await service.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(
        "bootstrap-super-admin: rollback deleteUser failed",
        deleteError.status ?? "no-status",
      );
    }
    return errorResponse("internal_error");
  }

  return okResponse("criado", userId);
}

/** Ambiente lido pelo handler. Injetado para os testes não dependerem de `Deno.env`. */
export type BootstrapEnv = {
  bootstrapSecret: string | undefined;
  atlasEnv: string | undefined;
  allowNonLocal: string | undefined;
};

export type BootstrapHandlerOptions = {
  readEnv: () => BootstrapEnv;
  createService: () => SupabaseClient;
};

/**
 * Cria o handler HTTP. O client só é criado depois da autenticação e da trava de ambiente, então
 * uma chamada recusada nunca toca no banco.
 */
export function createBootstrapHandler(
  options: BootstrapHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const env = options.readEnv();

    // 1. Sem segredo configurado, a rota não existe para nenhum método.
    if (!env.bootstrapSecret) return notFoundResponse();

    // 2. Preflight e método, agora que a rota já se revelou existente.
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return errorResponse("method_not_allowed");
    }

    try {
      // 3 e 4. Autenticidade e trava de ambiente, antes de qualquer leitura ou escrita.
      const access = await authorizeBootstrapRequest({
        presentedSecret: req.headers.get(BOOTSTRAP_SECRET_HEADER),
        expectedSecret: env.bootstrapSecret,
        atlasEnv: env.atlasEnv,
        allowNonLocal: env.allowNonLocal,
      });
      if (!access.ok) return accessResponse(access);

      let service: SupabaseClient;
      try {
        service = options.createService();
      } catch (err) {
        console.error("config", err instanceof Error ? err.message : "erro");
        return errorResponse("internal_error");
      }

      // 5. Decisão pelo estado atual e execução.
      const existing = await findUserByEmail(service, SUPER_ADMIN_EMAIL);
      const decision = await decideForUser(service, existing);
      switch (decision.kind) {
        case "ja_existe":
          return okResponse("ja_existe", decision.userId);
        case "recusa_papel":
          return errorResponse("email_com_outro_papel");
        case "sem_profile":
          console.error("bootstrap-super-admin: usuário do Auth sem profile; recuperação manual necessária");
          return errorResponse("usuario_sem_profile");
        case "criado": {
          // Freeze BE-03: com operadores internos já existentes, novos bootstraps
          // são recusados (tabela ausente em ambiente antigo = permite o primeiro).
          try {
            const { data } = await service.from("internal_operators").select("user_id").limit(1);
            if (Array.isArray(data) && data.length > 0) {
              console.warn("bootstrap-super-admin: blocked, operators exist");
              return errorResponse("bootstrap_bloqueado");
            }
          } catch {
            // Tabela ainda não migrada: segue o fluxo legado de criação.
          }
          return await createSuperAdmin(service);
        }
      }
    } catch (err) {
      console.error("handler", err instanceof Error ? err.message : "erro inesperado");
      return errorResponse("internal_error");
    }
  };
}
