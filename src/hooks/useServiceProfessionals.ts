import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Vínculo N:N `service_professionals`. Sem RPC atômico nesta fase (D8): o
 * cliente envia a lista completa de `professional_id` desejados e o hook faz o
 * **diff** (insert dos novos, delete dos removidos) sob RLS — cada operação
 * validada por `WITH CHECK`/`USING` por tenant. Nenhum `tenant_id` é enviado.
 */

const linkRowSchema = z.object({ professional_id: z.string() });
const linkListSchema = z.array(linkRowSchema);

function serviceProfessionalsKey(serviceId: string) {
  return ["service-professionals", serviceId] as const;
}

/**
 * Insere vínculos N:N para um serviço recém-criado (fluxo de criação, onde o
 * `serviceId` só existe após o insert, então o hook `useSetServiceProfessionals`
 * — que exige o id de antemão — não se aplica). Sem `tenant_id` do cliente; o
 * banco o deriva de `current_tenant_id()` sob RLS.
 */
export async function insertServiceProfessionals(
  serviceId: string,
  professionalIds: string[],
) {
  if (professionalIds.length === 0) return;
  const { error } = await supabase.from("service_professionals").insert(
    professionalIds.map((professional_id) => ({
      service_id: serviceId,
      professional_id,
    })),
  );
  if (error) throw error;
}

/** IDs dos profissionais vinculados a um serviço. */
export function useServiceProfessionals(serviceId: string | null) {
  return useQuery<string[]>({
    queryKey: serviceProfessionalsKey(serviceId ?? "none"),
    enabled: !!serviceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_professionals")
        .select("professional_id")
        .eq("service_id", serviceId as string);
      if (error) throw error;
      return linkListSchema.parse(data).map((row) => row.professional_id);
    },
  });
}

/**
 * Substitui o conjunto de vínculos de um serviço pela lista desejada. Lê o
 * estado atual, calcula o diff e aplica inserts/deletes sob RLS. `tenant_id`
 * não é enviado — o banco o deriva de `current_tenant_id()`.
 */
export function useSetServiceProfessionals(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (desiredProfessionalIds: string[]) => {
      const { data: current, error: readError } = await supabase
        .from("service_professionals")
        .select("professional_id")
        .eq("service_id", serviceId);
      if (readError) throw readError;

      const currentIds = linkListSchema
        .parse(current)
        .map((row) => row.professional_id);
      const desired = new Set(desiredProfessionalIds);
      const existing = new Set(currentIds);

      const toInsert = desiredProfessionalIds.filter((id) => !existing.has(id));
      const toDelete = currentIds.filter((id) => !desired.has(id));

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("service_professionals")
          .insert(
            toInsert.map((professional_id) => ({
              service_id: serviceId,
              professional_id,
            })),
          );
        if (insertError) throw insertError;
      }

      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("service_professionals")
          .delete()
          .eq("service_id", serviceId)
          .in("professional_id", toDelete);
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: serviceProfessionalsKey(serviceId),
      });
    },
  });
}
