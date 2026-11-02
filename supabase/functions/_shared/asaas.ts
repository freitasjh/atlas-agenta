// Shared helpers for Asaas integration (ADR-20).

export type AsaasEnvironment = "sandbox" | "production";

export function asaasBaseUrl(env: AsaasEnvironment): string {
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

export async function asaasFetch(
  baseUrl: string,
  apiKey: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
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
