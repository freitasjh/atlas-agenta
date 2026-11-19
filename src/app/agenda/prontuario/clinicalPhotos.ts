import { z } from "zod";

import { formatDateInTenantTz } from "@/lib/datetime";

export const FOTO_TIPOS = ["antes", "depois"] as const;
export type FotoTipo = (typeof FOTO_TIPOS)[number];

const fotoNomeSchema = z
  .string()
  .regex(/^(antes|depois)-\d{8}-\d{6}-[a-z0-9]{6}\.(jpe?g|png|webp)$/i);

export interface ClinicalPhoto {
  path: string;
  tipo: FotoTipo;
  /** Instante da captura codificado no nome do objeto (UTC). */
  takenAt: string;
  url: string;
}

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const EXTENSOES_PERMITIDAS = ["jpg", "jpeg", "png", "webp"] as const;

function randomSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) out += chars[byte % chars.length];
  return out;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Nome de objeto codificado: `<tipo>-<aaaammdd>-<hhmmss>-<rand6>.<ext>`. */
export function encodeFotoNome(tipo: FotoTipo, takenAt: Date, ext: string): string {
  const data = `${takenAt.getUTCFullYear()}${pad(takenAt.getUTCMonth() + 1)}${pad(takenAt.getUTCDate())}`;
  const hora = `${pad(takenAt.getUTCHours())}${pad(takenAt.getUTCMinutes())}${pad(takenAt.getUTCSeconds())}`;
  return `${tipo}-${data}-${hora}-${randomSuffix()}.${ext.toLowerCase()}`;
}

/** Extrai tipo + instante do nome do objeto; `null` quando fora do padrão. */
export function parseFotoNome(nome: string): { tipo: FotoTipo; takenAt: string } | null {
  const parsed = fotoNomeSchema.safeParse(nome);
  if (!parsed.success) return null;
  const match = /^(antes|depois)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(nome);
  if (!match) return null;
  const [, tipo, ano, mes, dia, hora, min, seg] = match;
  return {
    tipo: tipo as FotoTipo,
    takenAt: `${ano}-${mes}-${dia}T${hora}:${min}:${seg}.000Z`,
  };
}

/** Alt canônico: "Antes — dd/mm/aaaa" (UX-SPEC T1 item 4). */
export function fotoAltText(photo: { tipo: FotoTipo; takenAt: string }, timeZone: string): string {
  const rotulo = photo.tipo === "antes" ? "Antes" : "Depois";
  return `${rotulo} — ${formatDateInTenantTz(photo.takenAt, timeZone)}`;
}

export function validateFotoFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(EXTENSOES_PERMITIDAS as readonly string[]).includes(ext)) {
    return "Envie uma foto em JPG, PNG ou WebP.";
  }
  if (file.size > MAX_FOTO_BYTES) {
    return "A foto precisa ter no máximo 5 MB.";
  }
  return null;
}

export function mapFotosError(error: unknown): string {
  if (error instanceof Error && error.message === "consentimento-requerido") {
    return "Registre o termo de consentimento abaixo antes de enviar fotos.";
  }
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.startsWith("Envie uma foto") ) return error.message;
  if (error instanceof Error && error.message.startsWith("A foto precisa")) return error.message;
  return "Não foi possível carregar as fotos. Tente de novo.";
}
