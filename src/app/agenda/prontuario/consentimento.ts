/**
 * Consentimento clínico (ADR-05): termo global, assinatura única por cliente.
 *
 * Persistência zero-backend: o termo assinado é um JSON append-only no Storage
 * privado (`clinical-media`), em `<customerId>/termo-consentimento.json`.
 * Sem policy de UPDATE/DELETE no bucket + verificação de existência antes de
 * gravar: assinado é imutável. Nenhum dado clínico/PII sai daqui para
 * log/toast/URL — mensagens de erro são fixas e genéricas.
 */

export const CLINICAL_MEDIA_BUCKET = "clinical-media";

/** Caminho do termo assinado de um cliente (assinatura única). */
export function termoPath(customerId: string): string {
  return `${customerId}/termo-consentimento.json`;
}

/** Prefixo das fotos de um atendimento. */
export function fotosPrefix(customerId: string, appointmentId: string): string {
  return `${customerId}/${appointmentId}/fotos`;
}

/** Caminho do mapa facial de um atendimento. */
export function mapaPath(customerId: string, appointmentId: string): string {
  return `${customerId}/${appointmentId}/mapa-facial.json`;
}

export const TERMO_METODO = ["traco", "nome", "ambos"] as const;
export type TermoMetodo = (typeof TERMO_METODO)[number];

export interface TermoAssinado {
  customerId: string;
  signerName: string;
  signedAt: string;
  method: TermoMetodo;
  hash: string;
}

export const TERMO_TEXTO = [
  "Autorizo o registro de fotografias de antes e depois, o preenchimento do mapa facial e a guarda desses materiais junto ao meu prontuário, exclusivamente para acompanhamento do tratamento estético.",
  "Estou ciente de que as fotos são imutáveis (não podem ser apagadas) e ficam armazenadas em ambiente privado, acessível apenas à equipe clínica responsável pelo meu atendimento.",
  "Posso solicitar esclarecimentos sobre o uso dos meus dados a qualquer momento. Esta autorização vale como consentimento para fins da Lei Geral de Proteção de Dados (LGPD).",
].join("\n\n");

/**
 * Hash determinístico de integridade (cyrb53, hex 16 chars). Síncrono para
 * não depender de `crypto.subtle` no teste/navegador; exibido como código de
 * verificação do termo assinado.
 */
export function hashConsentimento(canonical: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < canonical.length; i += 1) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, "0");
  const lo = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${hi}${lo}`;
}

/** Carga canônica do termo (nome + instante + método), sem PII além do nome. */
export function canonicalTermo(input: {
  signerName: string;
  signedAt: string;
  method: TermoMetodo;
}): string {
  return [input.signerName.trim(), input.signedAt, input.method].join("|");
}

export function mapConsentimentoError(error: unknown): string {
  if (error instanceof Error && error.message === "termo-ja-registrado") {
    return "Termo já registrado para este cliente.";
  }
  // Corrida no registro: o upload com `upsert: false` perde para um termo
  // gravado entre a checagem de existência e o upload — o Storage devolve
  // conflito ("duplicate"/"already exists"). Mapeia para termo-já-registrado.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message ?? "")
          : "";
  if (/duplicate|already exists|termo-ja-registrado/i.test(message)) {
    return "Termo já registrado para este cliente.";
  }
  return "Não foi possível registrar o termo. Tente de novo.";
}
