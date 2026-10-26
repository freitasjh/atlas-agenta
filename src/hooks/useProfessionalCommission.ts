import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { bpsToNumericPct, numericPctToBps } from "@/lib/commission";

/**
 * Hooks de dados da TAXA de comissão de um profissional (ADR-06, Fase 1b).
 *
 * A taxa mora em `professional_commissions` (ADR-01) — tabela separada de
 * `professionals` por ser dado financeiro sensível com RLS própria. Por isso,
 * diferente de `name`/`active` (mutations de `professionals`), a % precisa de um
 * par leitura/escrita próprio, análogo a `useScheduleValidity` /
 * `useUpdateScheduleValidity`.
 *
 * Nenhuma escrita envia `tenant_id` (o RLS o deriva de `current_tenant_id()`).
 * A conversão bps↔numeric fica confinada à borda (`commission.ts`): o banco
 * guarda `numeric(5,2)`, a UI trabalha em bps inteiro. A trava real de acesso é
 * o RLS `professional_commissions_write_admin` (só admin escreve); o gating de
 * UI é defesa em profundidade.
 */

const commissionRowSchema = z.object({
  professional_id: z.string(),
  commission_pct: z.number(),
});

const commissionKey = (professionalId: string | null) =>
  ["professional_commissions", professionalId] as const;

/**
 * Lê a taxa corrente de um profissional em bps inteiro. Devolve `0` quando não
 * há linha cadastrada (fail-safe: profissional sem % apura R$ 0,00, alinhado ao
 * gancho do servidor). A query só roda quando habilitada (`enabled`) — tipicamente
 * sob `canManageCommission` e com o diálogo de edição aberto.
 */
export function useProfessionalCommission(
  professionalId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery<number>({
    queryKey: commissionKey(professionalId),
    enabled: (options?.enabled ?? true) && !!professionalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("professional_commissions")
        .select("professional_id, commission_pct")
        .eq("professional_id", professionalId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return 0;
      return numericPctToBps(commissionRowSchema.parse(data).commission_pct);
    },
  });
}

/**
 * Cadastra/atualiza a % de comissão de um profissional (upsert da linha
 * `(tenant_id, professional_id)` — chave composta). `tenant_id` nunca vai no
 * corpo; o default `current_tenant_id()` o preenche sob RLS. Converte o bps da
 * UI para `numeric(5,2)` na borda. Invalida a chave de comissão do profissional.
 */
export function useUpsertProfessionalCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      professionalId,
      commissionBps,
    }: {
      professionalId: string;
      commissionBps: number;
    }) => {
      const { data, error } = await supabase
        .from("professional_commissions")
        .upsert(
          {
            professional_id: professionalId,
            commission_pct: bpsToNumericPct(commissionBps),
          },
          { onConflict: "tenant_id,professional_id" },
        )
        .select("professional_id, commission_pct")
        .single();
      if (error) throw error;
      return commissionRowSchema.parse(data);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: commissionKey(variables.professionalId),
      });
    },
  });
}
