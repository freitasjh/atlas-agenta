/** Claims de um access token JWT, sem validação de assinatura (o GoTrue já validou na emissão). */
export interface AccessTokenClaims {
  sub?: string;
  role?: string;
  user_role?: string | null;
  tenant_id?: string | null;
  must_change_password?: boolean;
  exp?: number;
  [key: string]: unknown;
}

export function decodeAccessToken(accessToken: string): AccessTokenClaims {
  const parts = accessToken.split(".");
  if (parts.length < 2) throw new Error("Access token fora do formato JWT.");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const parsed: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Payload do access token inválido.");
  }
  return parsed as AccessTokenClaims;
}
