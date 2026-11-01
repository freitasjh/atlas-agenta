// Handler da Edge Function `change-password` — ADR-04 (troca de senha no Auth nativo).
//
// A lógica vive aqui, recebendo o client Supabase por injeção, para os testes rodarem com um fake
// sem subir servidor. `index.ts` só lê o ambiente, cria o client com a service role e chama
// `Deno.serve`.
//
// Ordem rígida, nenhum efeito antes dos passos anteriores:
//   1. `OPTIONS` → 200 (preflight) e método diferente de `POST` → 405;
//   2. JWT do usuário: `auth.getUser(token)` devolve o usuário e o `app_metadata` atual. Sem
//      token, token recusado pelo GoTrue (401) ou sem usuário → 401 `unauthenticated`. 403 do
//      GoTrue NÃO é sessão expirada: o serviço recusou a chamada (service role/papel ou conta
//      bloqueada), então vira 503 `auth_indisponivel`, com log de servidor. Indisponibilidade
//      do GoTrue → 503 `auth_indisponivel`;
//   3. corpo validado (schemas.ts) antes de qualquer escrita: `.strict()`, mínimo de 8 code
//      points, máximo de 72 bytes UTF-8 e diferente da senha provisória;
//   4. `app_metadata.must_change_password !== true` → 409 `password_change_not_required`
//      (a flag já foi limpa, por esta ou por outra chamada);
//   5. UMA chamada `auth.admin.updateUserById(id, { password, app_metadata: { ...app_metadata,
//      must_change_password: false } })` grava a senha e limpa a flag juntos, sem estado
//      intermediário. As chaves `provider` e `providers` continuam porque o objeto anterior é
//      mantido intacto;
//   6. `auth.admin.signOut(token, 'others')` encerra as outras sessões do usuário. Falha aqui NÃO
//      desfaz a troca (a senha já foi gravada): vai só para o log, com o status;
//   7. responde 200 `{ ok: true }`.
//
// Concorrência (D-F): última escrita vence. Não há lock nem tabela; duas chamadas quase
// simultâneas podem responder 200, e a que chegar depois da flag limpa recebe 409.
//
// Erros do GoTrue na escrita são classificados por status (nunca pela mensagem do servidor):
//   400/422 (senha recusada pelo Auth)                 → 400 `password_rejected`;
//   401/403 (service role/papel recusado: configuração) → 500 `internal_error`;
//   429, 5xx, timeout, rede ou status ausente           → 503 `auth_indisponivel`;
//   demais 4xx (404, 409)                               → 500 `internal_error` — o usuário veio
//     do JWT, então o problema é de estado/configuração do servidor, não do cliente.
// Respostas e logs nunca contêm senha, hash, service role nem nome de segredo — só código de
// erro e status.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  buildPasswordUpdate,
  parseChangePasswordBody,
  type PasswordBodyErrorCode,
} from "./schemas.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "method_not_allowed"
  | "unauthenticated"
  | "password_rejected"
  | "password_change_not_required"
  | "auth_indisponivel"
  | "internal_error"
  | PasswordBodyErrorCode;

const ERROR_STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unauthenticated: 401,
  invalid_body: 400,
  password_too_short: 400,
  password_too_long: 400,
  password_is_initial: 400,
  password_rejected: 400,
  password_change_not_required: 409,
  auth_indisponivel: 503,
  internal_error: 500,
};

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  method_not_allowed: "Método não suportado.",
  unauthenticated: "Sessão inválida ou expirada.",
  invalid_body: "Dados inválidos.",
  password_too_short: "A senha deve ter no mínimo 8 caracteres.",
  password_too_long: "A senha deve ter no máximo 72 bytes.",
  password_is_initial: "Escolha uma senha diferente da senha provisória.",
  password_rejected: "A senha informada não foi aceita. Escolha outra.",
  password_change_not_required: "Não há troca de senha pendente para esta conta.",
  auth_indisponivel: "Serviço de autenticação indisponível. Tente novamente.",
  internal_error: "Não foi possível trocar a senha. Tente novamente.",
};

/** Resposta de erro padronizada `{ code, message }`, com status do código. */
function errorResponse(code: ErrorCode): Response {
  return new Response(JSON.stringify({ code, message: ERROR_MESSAGES[code] }), {
    status: ERROR_STATUS[code],
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Token do header `Authorization`. Vazio quando o header falta ou não é Bearer. */
function readBearerToken(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Classifica o erro do GoTrue na escrita da senha. Só 400/422 são recusa da SENHA (o cliente
 * pode escolher outra); 401/403 são o GoTrue recusando a CHAMADA — a service role não foi aceita
 * —, o que é configuração/estado do servidor, não erro do usuário; 429, 5xx, timeout, rede e
 * status ausente são indisponibilidade. Nenhum ramo lê a mensagem do servidor.
 */
function classifyAuthWriteError(
  status: unknown,
): "password_rejected" | "internal_error" | "auth_indisponivel" {
  if (typeof status !== "number" || !Number.isFinite(status)) {
    return "auth_indisponivel";
  }
  if (status === 400 || status === 422) return "password_rejected";
  if (status === 429) return "auth_indisponivel";
  if (status >= 400 && status < 500) return "internal_error";
  return "auth_indisponivel";
}

type ResolvedUser =
  | { kind: "ok"; userId: string; appMetadata: unknown }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

/**
 * Resolve o usuário a partir do JWT validado pelo GoTrue.
 *
 * Só 401 e a ausência de usuário viram `unauthenticated`: é a resposta honesta para token
 * inválido ou expirado. 403 vira `unavailable`, porque com o client de service role o GoTrue
 * recusa a CHAMADA (chave/papel ou conta bloqueada), não a sessão do usuário — mapear para 401
 * mandaria o usuário ao login por um problema de infraestrutura.
 */
async function resolveUser(service: SupabaseClient, token: string): Promise<ResolvedUser> {
  const { data, error } = await service.auth.getUser(token);

  if (error) {
    if (error.status === 401) return { kind: "unauthenticated" };
    if (error.status === 403) {
      console.error("change-password: getUser recusado (403) — conferir service role/conta");
      return { kind: "unavailable" };
    }
    console.error("change-password: getUser failed", error.status ?? "no-status");
    return { kind: "unavailable" };
  }
  if (!data.user || typeof data.user.id !== "string" || data.user.id === "") {
    return { kind: "unauthenticated" };
  }

  return {
    kind: "ok",
    userId: data.user.id,
    appMetadata: data.user.app_metadata,
  };
}

/** O flag de troca obrigatória, lido de `app_metadata` (dado não confiável). */
function hasPendingChange(appMetadata: unknown): boolean {
  if (typeof appMetadata !== "object" || appMetadata === null) return false;
  return (appMetadata as Record<string, unknown>).must_change_password === true;
}

/**
 * Grava a senha e limpa a flag na MESMA chamada. Falha do GoTrue é classificada por status em
 * `classifyAuthWriteError` (400/422 → senha recusada; 401/403 e demais 4xx → 500; 429/5xx/rede
 * → 503). O log leva só a classe e o status: nunca a mensagem do GoTrue nem o payload.
 */
async function updatePassword(
  service: SupabaseClient,
  userId: string,
  password: string,
  appMetadata: unknown,
): Promise<Response | null> {
  let error: { status?: number } | null = null;
  try {
    const result = await service.auth.admin.updateUserById(
      userId,
      buildPasswordUpdate(appMetadata, password),
    );
    error = result.error;
  } catch (err) {
    console.error(
      "change-password: updateUserById threw",
      err instanceof Error ? err.name : "erro",
    );
    return errorResponse("auth_indisponivel");
  }

  if (!error) return null;

  const code = classifyAuthWriteError(error.status);
  console.error(
    "change-password: updateUserById failed",
    code,
    error.status ?? "no-status",
  );
  return errorResponse(code);
}

/**
 * Encerra as outras sessões do usuário. Best-effort: a troca já aconteceu, então falha aqui só
 * vai para o log com o status — nunca desfaz a senha nem muda a resposta.
 */
async function endOtherSessions(service: SupabaseClient, token: string): Promise<void> {
  try {
    const { error } = await service.auth.admin.signOut(token, "others");
    if (error) {
      console.error("change-password: signOut others failed", error.status ?? "no-status");
    }
  } catch (err) {
    console.error(
      "change-password: signOut others threw",
      err instanceof Error ? err.name : "erro",
    );
  }
}

export type ChangePasswordHandlerOptions = {
  /** Client com a service role. Criado por requisição; lançar aqui vira 500 sem tocar no Auth. */
  createService: () => SupabaseClient;
};

/** Cria o handler HTTP. A lógica inteira é injetável: os testes passam um client fake. */
export function createChangePasswordHandler(
  options: ChangePasswordHandlerOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return errorResponse("method_not_allowed");
    }

    try {
      let service: SupabaseClient;
      try {
        service = options.createService();
      } catch (err) {
        console.error("config", err instanceof Error ? err.message : "erro");
        return errorResponse("internal_error");
      }

      // 2. Autenticação: o usuário sai do JWT, nunca do corpo.
      const token = readBearerToken(req);
      if (!token) return errorResponse("unauthenticated");

      const auth = await resolveUser(service, token);
      if (auth.kind === "unauthenticated") return errorResponse("unauthenticated");
      if (auth.kind === "unavailable") return errorResponse("auth_indisponivel");

      // 3. Corpo validado antes de qualquer escrita.
      let rawBody: unknown;
      try {
        rawBody = await req.json();
      } catch {
        return errorResponse("invalid_body");
      }

      const body = parseChangePasswordBody(rawBody);
      if (!body.ok) return errorResponse(body.code);

      // 4. Sem flag ligada não há troca pendente: nada é gravado.
      if (!hasPendingChange(auth.appMetadata)) {
        return errorResponse("password_change_not_required");
      }

      // 5. Senha e flag na mesma chamada, mantendo o restante de `app_metadata`.
      const updateFailure = await updatePassword(
        service,
        auth.userId,
        body.password,
        auth.appMetadata,
      );
      if (updateFailure) return updateFailure;

      // 6. Outras sessões encerradas depois da troca; falha aqui só vai para o log.
      await endOtherSessions(service, token);

      // 7. Sucesso sem eco de senha, hash ou segredo.
      return okResponse();
    } catch (err) {
      console.error("handler", err instanceof Error ? err.message : "erro inesperado");
      return errorResponse("internal_error");
    }
  };
}
