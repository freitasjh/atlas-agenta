import { loadEnv } from "./env.ts";

export interface FunctionResponse {
  status: number;
  /** Corpo bruto da resposta, para checar que segredos não vazam. */
  text: string;
  /** Corpo como objeto, quando for JSON. */
  json: Record<string, unknown> | null;
}

export interface CallOptions {
  method?: "POST" | "GET";
  /** Access token do usuário. Sem ele, a chamada vai sem Authorization. */
  token?: string;
  body?: unknown;
  rawBody?: string;
}

/** Chama uma Edge Function local, com a anon key como apikey (como o cliente real faz). */
export async function callFunction(name: string, options: CallOptions = {}): Promise<FunctionResponse> {
  const env = loadEnv();
  const headers: Record<string, string> = {
    apikey: env.anonKey,
    "Content-Type": "application/json",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

  const response = await fetch(`${env.apiUrl}/functions/v1/${name}`, {
    method: options.method ?? "POST",
    headers,
    body: options.method === "GET" ? undefined : payload,
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      json = parsed as Record<string, unknown>;
    }
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}
