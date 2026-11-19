import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  CLINICAL_MEDIA_BUCKET,
  mapConsentimentoError,
  termoPath,
  type TermoAssinado,
  type TermoMetodo,
  canonicalTermo,
  hashConsentimento,
} from "@/app/agenda/prontuario/consentimento";

const TERMO_KEY = ["termo-consentimento"] as const;

function parseTermo(blob: Blob): Promise<TermoAssinado | null> {
  return blob.text().then((text) => {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      if (
        typeof raw.signerName !== "string" ||
        typeof raw.signedAt !== "string" ||
        typeof raw.hash !== "string" ||
        typeof raw.customerId !== "string"
      ) {
        return null;
      }
      return raw as unknown as TermoAssinado;
    } catch {
      return null;
    }
  });
}

/**
 * Termo de consentimento do cliente (global, assinatura única).
 * Leitura: download do JSON no Storage privado; ausência = pendente.
 * Escrita: upload com `upsert: false` + checagem de existência — sem UPDATE
 * nem DELETE em nenhum caminho (imutável). Erros genéricos, sem PII.
 */
export function useTermoConsentimento(options: {
  customerId: string | null;
  enabled: boolean;
}) {
  const { customerId, enabled } = options;
  return useQuery<TermoAssinado | null>({
    queryKey: [...TERMO_KEY, { customerId }],
    enabled: enabled && customerId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(CLINICAL_MEDIA_BUCKET)
        .download(termoPath(customerId as string));
      if (error || !data) return null;
      return parseTermo(data);
    },
  });
}

export interface AssinarTermoInput {
  customerId: string;
  signerName: string;
  method: TermoMetodo;
}

export function useAssinarTermo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssinarTermoInput) => {
      const path = termoPath(input.customerId);
      const bucket = supabase.storage.from(CLINICAL_MEDIA_BUCKET);
      const existing = await bucket.download(path);
      if (!existing.error && existing.data) {
        throw new Error("termo-ja-registrado");
      }
      const signedAt = new Date().toISOString();
      const hash = hashConsentimento(
        canonicalTermo({ signerName: input.signerName, signedAt, method: input.method }),
      );
      const termo: TermoAssinado = {
        customerId: input.customerId,
        signerName: input.signerName.trim(),
        signedAt,
        method: input.method,
        hash,
      };
      const { error } = await bucket.upload(
        path,
        new Blob([JSON.stringify(termo)], { type: "application/json" }),
        { contentType: "application/json", upsert: false },
      );
      if (error) throw error;
      return termo;
    },
    onSuccess: (termo) => {
      void queryClient.invalidateQueries({
        queryKey: [...TERMO_KEY, { customerId: termo.customerId }],
      });
    },
  });
}

export { mapConsentimentoError };
