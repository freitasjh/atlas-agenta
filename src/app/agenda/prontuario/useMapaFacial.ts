import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import {
  CLINICAL_MEDIA_BUCKET,
  mapaPath,
} from "@/app/agenda/prontuario/consentimento";

export interface ZonaFacial {
  id: string;
  nome: string;
  /** Posição do botão sobre o rosto (percentuais do contêiner). */
  left: string;
  top: string;
  width: string;
  height: string;
}

/**
 * Zonas do mapa facial (UX-SPEC T1 item 5 + ajuste 8): cada zona vira um
 * `<button>` nativo com nome acessível. Medidas em % com mínimo de 44px
 * garantido pela classe do botão (toque ≥44px).
 */
export const ZONAS_FACIAIS: ZonaFacial[] = [
  { id: "testa", nome: "Testa", left: "32%", top: "4%", width: "36%", height: "17%" },
  { id: "olho-esquerdo", nome: "Olho esquerdo", left: "20%", top: "24%", width: "24%", height: "15%" },
  { id: "olho-direito", nome: "Olho direito", left: "56%", top: "24%", width: "24%", height: "15%" },
  { id: "nariz", nome: "Nariz", left: "40%", top: "34%", width: "20%", height: "19%" },
  { id: "bochecha-esquerda", nome: "Bochecha esquerda", left: "12%", top: "42%", width: "26%", height: "19%" },
  { id: "bochecha-direita", nome: "Bochecha direita", left: "62%", top: "42%", width: "26%", height: "19%" },
  { id: "boca", nome: "Boca e lábios", left: "36%", top: "60%", width: "28%", height: "15%" },
  { id: "queixo", nome: "Queixo", left: "34%", top: "77%", width: "32%", height: "17%" },
];

const MAPA_KEY = ["mapa-facial"] as const;

interface MapaPersistido {
  zones: string[];
}

/**
 * Mapa facial: seleção de zonas por atendimento, persistida como JSON no
 * Storage privado. Edição livre (não é append-only); só perfis clínicos
 * escrevem. Erros genéricos, sem PII.
 */
export function useMapaFacial(options: {
  customerId: string | null;
  appointmentId: string | null;
  enabled: boolean;
}) {
  const { customerId, appointmentId, enabled } = options;
  const queryClient = useQueryClient();
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  // Edição local vence a chegada tardia do fetch: depois do primeiro toggle,
  // o dado da rede não sobrescreve mais a seleção da sessão.
  const dirtyRef = useRef(false);

  const query = useQuery({
    queryKey: [...MAPA_KEY, { customerId, appointmentId }],
    enabled: enabled && customerId !== null && appointmentId !== null,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.storage
        .from(CLINICAL_MEDIA_BUCKET)
        .download(mapaPath(customerId as string, appointmentId as string));
      if (error || !data) return [];
      try {
        const raw = JSON.parse(await data.text()) as MapaPersistido;
        return Array.isArray(raw.zones)
          ? raw.zones.filter((id) => ZONAS_FACIAIS.some((zona) => zona.id === id))
          : [];
      } catch {
        return [];
      }
    },
  });

  useEffect(() => {
    if (query.data && !dirtyRef.current) setSelecionadas(query.data);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (zones: string[]) => {
      const path = mapaPath(customerId as string, appointmentId as string);
      const { error } = await supabase.storage
        .from(CLINICAL_MEDIA_BUCKET)
        .upload(
          path,
          new Blob([JSON.stringify({ zones })], { type: "application/json" }),
          { contentType: "application/json", upsert: true },
        );
      if (error) throw error;
    },
    onError: () => {
      toast.error("Não foi possível salvar o mapa facial. Tente de novo.");
    },
    onSuccess: (_data, zones) => {
      void queryClient.setQueryData([...MAPA_KEY, { customerId, appointmentId }], zones);
    },
  });

  function toggleZona(id: string) {
    dirtyRef.current = true;
    const next = selecionadas.includes(id)
      ? selecionadas.filter((zona) => zona !== id)
      : [...selecionadas, id];
    setSelecionadas(next);
    save.mutate(next);
  }

  return {
    selecionadas,
    isLoading: query.isLoading,
    toggleZona,
  };
}
