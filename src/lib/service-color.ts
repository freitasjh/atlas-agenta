/**
 * Cor por serviço derivada deterministicamente do `service_id` (ADR-01).
 *
 * Não há coluna de cor em `services` e o escopo proíbe migration: a cor é um
 * hash estável do `service_id` mapeado numa paleta de 8 tokens (ver
 * `--service-1..8` em src/index.css / tailwind.config.ts). O mesmo serviço tem
 * sempre a mesma cor, sem persistir estado. A cor é usada como marcador gráfico
 * (dot) sempre acompanhado do nome do serviço em texto — nunca como único sinal.
 */

/** Quantidade de tokens de cor de serviço (`--service-1..8`). */
export const SERVICE_COLOR_COUNT = 8;

/**
 * Classes Tailwind do dot de cor, uma por índice `0..7`. Strings estáticas
 * literais para o Tailwind não purgar as classes `bg-service-N`.
 */
const SERVICE_DOT_CLASSES = [
  "bg-service-1",
  "bg-service-2",
  "bg-service-3",
  "bg-service-4",
  "bg-service-5",
  "bg-service-6",
  "bg-service-7",
  "bg-service-8",
] as const;

/**
 * Hash FNV-1a de 32 bits — determinístico e com boa dispersão para strings
 * curtas como uuids. Usa aritmética sem sinal via `>>> 0`.
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // hash *= 16777619, em 32 bits, sem Math.imul para manter clareza.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Índice determinístico `0..SERVICE_COLOR_COUNT-1` para um `service_id`.
 * Mesmo id → sempre o mesmo índice.
 */
export function serviceColorIndex(serviceId: string): number {
  return fnv1a(serviceId) % SERVICE_COLOR_COUNT;
}

/**
 * Classe Tailwind do dot de cor (`bg-service-N`) para um `service_id`.
 * Mesmo id → sempre a mesma classe.
 */
export function serviceColorDotClass(serviceId: string): string {
  return SERVICE_DOT_CLASSES[serviceColorIndex(serviceId)];
}
