import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Vínculo N:N `combo_services` (serviços que compõem um pacote do salão).
 * Espelho de `service_professionals`: sem RPC atômico nesta fase, o cliente
 * envia a lista completa de `service_id` desejados e o hook faz o **diff**
 * (insert dos novos, delete dos removidos) sob RLS — cada operação validada por
 * `WITH CHECK`/`USING` por tenant. Nenhum `tenant_id` é enviado (o banco o
 * deriva de `current_tenant_id()`).
 */

const linkRowSchema = z.object({ service_id: z.string() });
const linkListSchema = z.array(linkRowSchema);

function comboServicesKey(comboId: string) {
  return ["combo-services", comboId] as const;
}

/**
 * Insere vínculos N:N para um pacote recém-criado (fluxo de criação, onde o
 * `comboId` só existe após o insert do combo). Sem `tenant_id` do cliente; o
 * banco o deriva de `current_tenant_id()` sob RLS.
 */
export async function insertComboServices(
  comboId: string,
  serviceIds: string[],
) {
  if (serviceIds.length === 0) return;
  const { error } = await supabase.from("combo_services").insert(
    serviceIds.map((service_id) => ({
      combo_id: comboId,
      service_id,
    })),
  );
  if (error) throw error;
}

/**
 * Substitui o conjunto de serviços de um pacote pela lista desejada: lê o
 * estado atual, calcula o diff e aplica inserts/deletes sob RLS. `tenant_id`
 * não é enviado. Função pura de dados reusada pela mutação de atualização de
 * combo (`useUpdateCombo`) e pelo hook `useSetComboServices`.
 */
export async function setComboServices(comboId: string, serviceIds: string[]) {
  const { data: current, error: readError } = await supabase
    .from("combo_services")
    .select("service_id")
    .eq("combo_id", comboId);
  if (readError) throw readError;

  const currentIds = linkListSchema
    .parse(current)
    .map((row) => row.service_id);
  const desired = new Set(serviceIds);
  const existing = new Set(currentIds);

  const toInsert = serviceIds.filter((id) => !existing.has(id));
  const toDelete = currentIds.filter((id) => !desired.has(id));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("combo_services")
      .insert(
        toInsert.map((service_id) => ({ combo_id: comboId, service_id })),
      );
    if (insertError) throw insertError;
  }

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("combo_services")
      .delete()
      .eq("combo_id", comboId)
      .in("service_id", toDelete);
    if (deleteError) throw deleteError;
  }
}

/** IDs dos serviços que compõem um pacote. */
export function useComboServices(comboId: string | null) {
  return useQuery<string[]>({
    queryKey: comboServicesKey(comboId ?? "none"),
    enabled: !!comboId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("combo_services")
        .select("service_id")
        .eq("combo_id", comboId as string);
      if (error) throw error;
      return linkListSchema.parse(data).map((row) => row.service_id);
    },
  });
}

/**
 * Substitui o conjunto de serviços de um pacote pela lista desejada (diff
 * insert/delete sob RLS) e invalida o cache do vínculo. `tenant_id` não é
 * enviado — o banco o deriva de `current_tenant_id()`.
 */
export function useSetComboServices(comboId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (desiredServiceIds: string[]) => {
      await setComboServices(comboId, desiredServiceIds);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: comboServicesKey(comboId),
      });
    },
  });
}
