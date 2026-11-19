import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  CLINICAL_MEDIA_BUCKET,
  fotosPrefix,
} from "@/app/agenda/prontuario/consentimento";
import {
  encodeFotoNome,
  mapFotosError,
  parseFotoNome,
  validateFotoFile,
  type ClinicalPhoto,
  type FotoTipo,
} from "@/app/agenda/prontuario/clinicalPhotos";

const FOTOS_KEY = ["fotos-antes-depois"] as const;

const SIGNED_URL_TTL_SEGUNDOS = 3600;

/**
 * Fotos antes/depois (ADR-05): somente leitura + inserção no Storage privado.
 * Append-only por construção — este módulo nunca chama `remove`/`update` e não
 * exporta nenhuma função de exclusão. Upload exige consentimento prévio
 * (termo assinado); sem ele, recusa com mensagem fixa (sem PII).
 */
export function useClinicalPhotos(options: {
  customerId: string | null;
  appointmentId: string | null;
  consented: boolean;
  enabled: boolean;
}) {
  const { customerId, appointmentId, consented, enabled } = options;
  return useQuery<ClinicalPhoto[]>({
    queryKey: [...FOTOS_KEY, { customerId, appointmentId, consented }],
    enabled: enabled && customerId !== null && appointmentId !== null,
    queryFn: async () => {
      const bucket = supabase.storage.from(CLINICAL_MEDIA_BUCKET);
      const prefix = fotosPrefix(customerId as string, appointmentId as string);
      const { data, error } = await bucket.list(prefix);
      if (error) throw error;
      const entries = (data ?? []).flatMap((entry) => {
        const parsed = parseFotoNome(entry.name);
        if (!parsed) return [];
        return [{ name: entry.name, parsed }];
      });
      const signed = await Promise.all(
        entries.map(async ({ name, parsed }) => {
          const path = `${prefix}/${name}`;
          const { data: signedData, error: signError } = await bucket.createSignedUrl(
            path,
            SIGNED_URL_TTL_SEGUNDOS,
          );
          if (signError || !signedData?.signedUrl) return null;
          return {
            path,
            tipo: parsed.tipo,
            takenAt: parsed.takenAt,
            url: signedData.signedUrl,
          } satisfies ClinicalPhoto;
        }),
      );
      return signed
        .filter((photo): photo is ClinicalPhoto => photo !== null)
        .sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
    },
  });
}

export interface EnviarFotoInput {
  customerId: string;
  appointmentId: string;
  file: File;
  tipo: FotoTipo;
}

export function useEnviarFoto(consented: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EnviarFotoInput) => {
      if (!consented) throw new Error("consentimento-requerido");
      const invalid = validateFotoFile(input.file);
      if (invalid) throw new Error(invalid);
      const ext = input.file.name.split(".").pop() ?? "jpg";
      const nome = encodeFotoNome(input.tipo, new Date(), ext);
      const path = `${fotosPrefix(input.customerId, input.appointmentId)}/${nome}`;
      const { error } = await supabase.storage
        .from(CLINICAL_MEDIA_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (error) throw error;
      return path;
    },
    onSuccess: (_path, input) => {
      void queryClient.invalidateQueries({
        queryKey: [...FOTOS_KEY, { customerId: input.customerId, appointmentId: input.appointmentId, consented: true }],
      });
    },
  });
}

export { mapFotosError };
