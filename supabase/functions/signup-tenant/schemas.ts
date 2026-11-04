// Schemas e validação do corpo da Edge Function `signup-tenant` — ADR-002 (cadastro de empresa rico).
//
// O corpo é DADO NÃO CONFIÁVEL. Só os campos abaixo são aceitos. Qualquer campo extra (ex.: `role`,
// `tenant_id`, `whatsapp`, `app_metadata`) é recusado pelo `.strict()`. O papel é fixo no servidor (admin).
//
// Ordem de validação (cada falha devolve um único código, estável para o cliente):
//   1. formato do corpo (campos, tipos, enum de segment) → invalid_body
//   2. documento (só dígitos 11/14 + DV CPF/CNPJ)       → document_invalido
//   3. telefone da empresa (só dígitos 10/11)            → telefone_invalido
//   4. endereço (CEP 8 + logradouro + número + cidade + UF) → endereco_incompleto
//   5. nome do admin vazio                               → nome_admin_obrigatorio
//   6. senha com menos de 8 bytes UTF-8                 → password_too_short
//   7. senha com mais de 72 bytes UTF-8                 → password_too_long (limite do bcrypt no GoTrue)
//
// Máscaras são removidas antes de validar (só dígitos `[0-9]` persistem); UF vai para maiúscula.
// O DV usa o mesmo algoritmo da RPC (PL/pgSQL): sequências de dígito repetido nunca são válidas.
import { z } from "npm:zod@3.23.8";

export const MIN_PASSWORD_BYTES = 8;
export const MAX_PASSWORD_BYTES = 72;

/** Ramos aceitos no cadastro. Mesmos literais do check `tenants_segment_check` (20250225090000). */
export const SEGMENTS = ["barbearia", "clinica", "salao"] as const;

/** Remove tudo que não é dígito ASCII. Nunca `\d` (aceita dígitos unicode). */
export function stripDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

/** Normaliza UF: trim + maiúscula. Não-string vira "" para falhar no regex. */
function upperState(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isRepeated(digits: string): boolean {
  return digits.length > 0 && digits.split("").every((ch) => ch === digits[0]);
}

function checkDigit(sum: number): number {
  const rem = sum % 11;
  return rem < 2 ? 0 : 11 - rem;
}

/** DV de CPF: d1 sobre as 9 primeiras (pesos 10..2), d2 sobre as 10 (pesos 11..2). */
export function isValidCpf(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || isRepeated(digits)) return false;
  const nums = digits.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
  if (nums[9] !== checkDigit(sum)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += nums[i] * (11 - i);
  return nums[10] === checkDigit(sum);
}

/**
 * DV de CNPJ: d1 sobre as 12 primeiras, d2 sobre as 13; peso = 2 + ((distância da
 * posição do dígito) mod 8), cobrindo a sequência 2..9 da direita para a esquerda.
 */
export function isValidCnpj(digits: string): boolean {
  if (!/^[0-9]{14}$/.test(digits) || isRepeated(digits)) return false;
  const nums = digits.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += nums[i] * (2 + ((12 - 1 - i) % 8));
  if (nums[12] !== checkDigit(sum)) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += nums[i] * (2 + ((13 - 1 - i) % 8));
  return nums[13] === checkDigit(sum);
}

/** CPF (11) ou CNPJ (14) com DV válido. */
export function isValidDocument(digits: string): boolean {
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export const signupBodySchema = z
  .object({
    email: z.string().trim().max(254).email(),
    password: z.string(),
    trade_name: z.string().trim().min(2).max(120),
    legal_name: z.string().trim().min(2).max(120).optional(),
    document: z.preprocess(stripDigits, z.string()),
    phone_empresa: z.preprocess(stripDigits, z.string()),
    address_cep: z.preprocess(stripDigits, z.string()),
    address_street: z.string().trim().min(1).max(160),
    address_number: z.string().trim().min(1).max(20),
    address_complement: z.string().trim().max(60).optional(),
    address_city: z.string().trim().min(1).max(120),
    address_state: z.preprocess(upperState, z.string()),
    full_name: z.string().trim().min(1).max(120),
    segment: z.enum(SEGMENTS).optional(),
  })
  .strict();

export type SignupBody = z.infer<typeof signupBodySchema>;

export type SignupBodyErrorCode =
  | "invalid_body"
  | "document_invalido"
  | "telefone_invalido"
  | "endereco_incompleto"
  | "nome_admin_obrigatorio"
  | "password_too_short"
  | "password_too_long";

export type SignupBodyResult =
  | { ok: true; body: SignupBody }
  | { ok: false; code: SignupBodyErrorCode };

const DOCUMENT_PATHS = new Set(["document"]);
const PHONE_PATHS = new Set(["phone_empresa"]);
const ADDRESS_PATHS = new Set([
  "address_cep",
  "address_street",
  "address_number",
  "address_complement",
  "address_city",
  "address_state",
]);
const NAME_PATHS = new Set(["full_name"]);

/**
 * Mapeia os issues do zod para um único código estável. Formato (campo extra, tipo errado,
 * enum) → invalid_body; cada campo novo tem o código do ADR. A checagem de formato/DV acontece
 * aqui (pós-preprocess): documento fora de 11/14 dígitos ou com DV inválido → document_invalido.
 */
function mapIssuesToCode(issues: z.ZodIssue[]): SignupBodyErrorCode {
  let shape = false;
  let document = false;
  let phone = false;
  let address = false;
  let name = false;
  for (const issue of issues) {
    const head = issue.path.length > 0 ? String(issue.path[0]) : "";
    if (issue.code === "unrecognized_keys") {
      shape = true;
      continue;
    }
    if (DOCUMENT_PATHS.has(head)) {
      document = true;
      continue;
    }
    if (PHONE_PATHS.has(head)) {
      phone = true;
      continue;
    }
    if (ADDRESS_PATHS.has(head)) {
      address = true;
      continue;
    }
    if (NAME_PATHS.has(head)) {
      name = true;
      continue;
    }
    shape = true;
  }
  if (shape) return "invalid_body";
  if (document) return "document_invalido";
  if (phone) return "telefone_invalido";
  if (address) return "endereco_incompleto";
  if (name) return "nome_admin_obrigatorio";
  return "invalid_body";
}

/**
 * Valida o corpo bruto da requisição e devolve o corpo tipado (já normalizado: documento,
 * telefone e CEP só dígitos, UF em maiúscula) ou o código de erro. A senha não é
 * trimada: espaços fazem parte dela.
 */
export function parseSignupBody(raw: unknown): SignupBodyResult {
  const parsed = signupBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: mapIssuesToCode(parsed.error.issues) };
  }
  const body = parsed.data;
  if (!isValidDocument(body.document)) {
    return { ok: false, code: "document_invalido" };
  }
  if (!/^[0-9]{10,11}$/.test(body.phone_empresa)) {
    return { ok: false, code: "telefone_invalido" };
  }
  if (
    !/^[0-9]{8}$/.test(body.address_cep) ||
    body.address_street.length === 0 ||
    body.address_number.length === 0 ||
    body.address_city.length === 0 ||
    !/^[A-Z]{2}$/.test(body.address_state)
  ) {
    return { ok: false, code: "endereco_incompleto" };
  }
  const { password } = body;
  const passwordBytes = new TextEncoder().encode(password).length;
  if (passwordBytes < MIN_PASSWORD_BYTES) {
    return { ok: false, code: "password_too_short" };
  }
  if (passwordBytes > MAX_PASSWORD_BYTES) {
    return { ok: false, code: "password_too_long" };
  }
  return { ok: true, body };
}
