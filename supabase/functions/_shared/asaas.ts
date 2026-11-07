// Shared helpers for Asaas integration (ADR-20).

export type AsaasEnvironment = "sandbox" | "production";

export function asaasBaseUrl(env: AsaasEnvironment): string {
  // Seam determinístico para testes: a suíte de integração aponta para uma porta fechada.
  const override = Deno.env.get("ASAAS_API_BASE_URL");
  if (override && override.trim()) return override.trim().replace(/\/+$/, "");
  return env === "sandbox"
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

export async function deriveMasterKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("ASAAS_MASTER_KEY") ?? "";
  if (!raw.trim()) throw new Error("ASAAS_MASTER_KEY ausente ou vazio.");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(plain: string): Promise<string> {
  const key = await deriveMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...buf));
}

export async function decryptText(cipherB64: string): Promise<string> {
  const key = await deriveMasterKey();
  const buf = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Limite de cada chamada ao Asaas. O pior caso agregado da criação (até 6
 * chamadas) fica ~120s, abaixo do TTL do claim (180s, `GATEWAY_CLAIM_TTL_SECONDS`).
 */
export const ASAAS_FETCH_TIMEOUT_MS = 20_000;

export async function asaasFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        access_token: apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ASAAS_FETCH_TIMEOUT_MS),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch {
    // Falha de rede/timeout: deterministicamente reportada como status 0.
    return { ok: false, status: 0, data: null };
  }
}

export interface PixChargeResult {
  ok: boolean;
  status: number;
  paymentId: string | null;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
}

/** Cria a cobrança PIX e busca o QR/copia-e-cola. Falha vira `ok:false` (nunca exceção). */
export async function createPixCharge(
  baseUrl: string,
  apiKey: string,
  params: {
    customerId: string;
    amountCents: number;
    externalReference: string;
    expiresAt: string;
    description: string;
  },
): Promise<PixChargeResult> {
  const paymentRes = await asaasFetch(baseUrl, apiKey, "/payments", "POST", {
    customer: params.customerId,
    billingType: "PIX",
    value: Number((params.amountCents / 100).toFixed(2)),
    dueDate: params.expiresAt.slice(0, 10),
    description: params.description,
    externalReference: params.externalReference,
  });
  if (!paymentRes.ok || !paymentRes.data?.id) {
    return {
      ok: false,
      status: paymentRes.status,
      paymentId: null,
      pixQrCode: null,
      pixCopyPaste: null,
    };
  }
  const paymentId = String(paymentRes.data.id);
  const pixRes = await asaasFetch(baseUrl, apiKey, `/payments/${paymentId}/pixQrCode`);
  return {
    ok: true,
    status: paymentRes.status,
    paymentId,
    pixQrCode: pixRes.ok ? (pixRes.data?.encodedImage ?? null) : null,
    pixCopyPaste: pixRes.ok ? (pixRes.data?.payload ?? null) : null,
  };
}

/** Busca uma cobrança existente por `externalReference` (retomada após crash). */
export async function findPaymentByExternalReference(
  baseUrl: string,
  apiKey: string,
  externalReference: string,
): Promise<{ paymentId: string; pixQrCode: string | null; pixCopyPaste: string | null } | null> {
  const res = await asaasFetch(
    baseUrl,
    apiKey,
    `/payments?externalReference=${encodeURIComponent(externalReference)}`,
  );
  if (!res.ok || !Array.isArray(res.data?.data) || res.data.data.length === 0) return null;
  const paymentId = res.data.data[0]?.id;
  if (!paymentId) return null;
  const pixRes = await asaasFetch(baseUrl, apiKey, `/payments/${paymentId}/pixQrCode`);
  return {
    paymentId: String(paymentId),
    pixQrCode: pixRes.ok ? (pixRes.data?.encodedImage ?? null) : null,
    pixCopyPaste: pixRes.ok ? (pixRes.data?.payload ?? null) : null,
  };
}

/** Cancela a cobrança no gateway. 404 é tratado como "já cancelada" pelo chamador. */
export async function cancelPayment(
  baseUrl: string,
  apiKey: string,
  paymentId: string,
): Promise<{ ok: boolean; status: number; notFound: boolean }> {
  const res = await asaasFetch(
    baseUrl,
    apiKey,
    `/payments/${encodeURIComponent(paymentId)}`,
    "DELETE",
  );
  return { ok: res.ok, status: res.status, notFound: res.status === 404 };
}

/** Garante o cliente do Asaas (busca por externalReference; cria se ausente). */
export async function ensureAsaasCustomer(
  baseUrl: string,
  apiKey: string,
  params: { customerId: string; name: string; email?: string | null; phone?: string | null },
): Promise<string | null> {
  const lookup = await asaasFetch(
    baseUrl,
    apiKey,
    `/customers?externalReference=${encodeURIComponent(params.customerId)}`,
  );
  if (lookup.ok && Array.isArray(lookup.data?.data) && lookup.data.data.length > 0) {
    const existing = lookup.data.data[0]?.id;
    if (existing) return String(existing);
  }
  const created = await asaasFetch(baseUrl, apiKey, "/customers", "POST", {
    name: params.name,
    email: params.email ?? undefined,
    phone: params.phone ?? undefined,
    externalReference: params.customerId,
  });
  return created.ok && created.data?.id ? String(created.data.id) : null;
}

export function randomHex(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("config");
  // lazy import to avoid top-level
  return { url, key };
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Converte o valor monetário do gateway (reais) em centavos inteiros.
 * Tipo inesperado vira `null` — nunca lança e nunca inventa divergência.
 */
export function centsFromGatewayValue(value: unknown): number | null {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (normalized === "") return null;
    numeric = Number(normalized);
  } else {
    return null;
  }
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

/** Normaliza uma data do gateway para ISO-8601 UTC; entrada inválida vira `null`. */
export function parseGatewayDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = dateOnly ? new Date(`${trimmed}T00:00:00.000Z`) : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
