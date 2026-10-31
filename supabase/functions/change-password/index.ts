// Edge Function `change-password` — ADR-08 (Super Admin, troca obrigatória de senha).
//
// Único caminho que grava a senha nova de um usuário com `profiles.must_change_password = true`.
// Ordem garantida pelo handler:
//   1. o `userId` vem do JWT validado pelo GoTrue (nunca do corpo);
//   2. o corpo é validado (schemas.ts) antes de qualquer escrita;
//   3. a troca é reservada no banco (`claim_password_change`, ADR-08). Sem flag ligado: 409
//      `password_change_not_required`. Com reserva ativa de outra requisição: 409
//      `password_change_in_progress`. Nos dois casos nada é gravado;
//   4. a senha vai para o Auth ANTES do flag cair. Se o Auth falhar, a reserva é liberada e o
//      flag segue ligado;
//   5. o flag cai pela RPC `complete_password_change` (ADR-05), que só service role executa e
//      também limpa a reserva. Se a RPC falhar depois da senha gravada, a reserva é liberada e
//      uma nova tentativa é aceita.
//
// Respostas de erro: `{ code, message }` com mensagem pt-BR estável por código. Nunca ecoa a
// senha, o hash, a service role nem o nome do marcador. Logs técnicos curtos, sem PII.
//
// Molde: `supabase/functions/admin-subscription/index.ts` (CORS, service client, JSON).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseChangePasswordBody, type PasswordBodyErrorCode } from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "unauthenticated"
  | "password_change_not_required"
  | "password_change_in_progress"
  | "internal_error"
  | PasswordBodyErrorCode;

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  invalid_body: 400,
  password_too_short: 400,
  password_too_long: 400,
  password_is_initial: 400,
  password_change_not_required: 409,
  password_change_in_progress: 409,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  invalid_body: "Dados inválidos.",
  password_too_short: "A senha deve ter no mínimo 8 caracteres.",
  password_too_long: "A senha deve ter no máximo 72 bytes.",
  password_is_initial: "Escolha uma senha diferente da senha provisória.",
  password_change_not_required: "Não há troca de senha pendente para esta conta.",
  password_change_in_progress: "Já existe uma troca de senha em andamento. Aguarde e tente novamente.",
  internal_error: "Não foi possível trocar a senha. Tente novamente.",
};

/** Resposta de erro padronizada `{ code, message }`, com status do código. */
function errorResponse(code: ErrorCode): Response {
  return new Response(
    JSON.stringify({ code, message: ERROR_MESSAGES[code] }),
    {
      status: ERROR_STATUS[code],
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Client com a service role (bypassa RLS). Só no servidor, nunca exposto ao cliente. */
function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração do servidor ausente (SUPABASE_URL/SERVICE_ROLE_KEY).");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AuthResult =
  | { kind: "ok"; userId: string }
  | { kind: "unauthenticated" }
  | { kind: "error" };

/**
 * Resolve o userId a partir do JWT validado pelo GoTrue. Só o GoTrue rejeitando o token
 * (401/403) vira `unauthenticated`; falha de infraestrutura vira `error` (500), para o cliente
 * não tratar indisponibilidade do servidor como sessão expirada.
 */
async function resolveUserId(req: Request, service: SupabaseClient): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { kind: "unauthenticated" };

  const { data, error } = await service.auth.getUser(token);
  if (error) {
    if (error.status === 401 || error.status === 403) return { kind: "unauthenticated" };
    console.error("change-password: auth getUser failed", error.status ?? "no-status");
    return { kind: "error" };
  }
  if (!data.user) return { kind: "unauthenticated" };
  return { kind: "ok", userId: data.user.id };
}

async function changePassword(
  userId: string,
  password: string,
  service: SupabaseClient,
): Promise<Response> {
  // 3. Reserva a troca no banco, antes de tocar no Auth. Um único UPDATE condicional decide a
  //    corrida: só uma requisição fica com a reserva. As demais recebem 409 e a senha não muda.
  const { data: claim, error: claimErr } = await service.rpc("claim_password_change", {
    p_user_id: userId,
  });

  if (claimErr || typeof claim !== "string") {
    console.error("change-password: claim_password_change failed", claimErr?.message ?? "bad-shape");
    return errorResponse("internal_error");
  }
  if (claim === "not_required") {
    return errorResponse("password_change_not_required");
  }
  if (claim === "in_progress") {
    return errorResponse("password_change_in_progress");
  }
  if (claim !== "claimed") {
    console.error("change-password: unexpected claim result");
    return errorResponse("internal_error");
  }

  // 4. Grava a senha no Auth antes de zerar o flag (RQ-08). Se falhar, libera a reserva e o flag
  //    segue ligado, então a troca pode ser repetida.
  const { error: updateErr } = await service.auth.admin.updateUserById(userId, { password });
  if (updateErr) {
    console.error("change-password: auth password update failed");
    await releaseClaim(userId, service);
    return errorResponse("internal_error");
  }

  // 5. Zera o flag só pelo servidor. A RPC também limpa a reserva. `false` significa que o flag
  //    já estava zerado, o que com a reserva só ocorre se ela expirou e outra troca concluiu.
  const { data: completed, error: rpcErr } = await service.rpc("complete_password_change", {
    p_user_id: userId,
  });

  if (rpcErr) {
    console.error("change-password: complete_password_change failed", rpcErr.message);
    await releaseClaim(userId, service);
    return errorResponse("internal_error");
  }
  if (completed !== true) {
    return errorResponse("password_change_not_required");
  }

  return okResponse();
}

/** Libera a reserva após falha. Erro aqui só vai para o log: a reserva expira sozinha. */
async function releaseClaim(userId: string, service: SupabaseClient): Promise<void> {
  const { error } = await service.rpc("release_password_change_claim", { p_user_id: userId });
  if (error) {
    console.error("change-password: release_password_change_claim failed", error.message);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("method_not_allowed");
  }

  try {
    let service: SupabaseClient;
    try {
      service = createServiceClient();
    } catch (err) {
      console.error("config", err instanceof Error ? err.message : "erro");
      return errorResponse("internal_error");
    }

    // 1. Autenticação: o userId sai do JWT, nunca do corpo.
    const auth = await resolveUserId(req, service);
    if (auth.kind === "unauthenticated") {
      return errorResponse("unauthenticated");
    }
    if (auth.kind === "error") {
      return errorResponse("internal_error");
    }
    const userId = auth.userId;

    // 2. Corpo validado antes de qualquer escrita.
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("invalid_body");
    }

    const body = parseChangePasswordBody(rawBody);
    if (!body.ok) {
      return errorResponse(body.code);
    }

    return await changePassword(userId, body.password, service);
  } catch (err) {
    console.error("handler", err instanceof Error ? err.message : "erro inesperado");
    return errorResponse("internal_error");
  }
});
