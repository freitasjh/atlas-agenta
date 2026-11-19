import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import {
  clinicalRecordListSchema,
  clinicalRecordRowSchema,
  type ClinicalRecord,
} from "@/app/agenda/prontuario/types";

/**
 * Dados de `clinical_records` via PostgREST sob RLS — **só select e insert**,
 * nunca update/delete (append-only, trigger `clinical_records_append_only`).
 * Nenhum `tenant_id` é enviado: o banco deriva de `current_tenant_id()`.
 * Erros nunca ecoam conteúdo clínico (mensagem fixa, sem PII).
 */

export const CLINICAL_RECORDS_SELECT =
  "id, tenant_id, customer_id, appointment_id, supersedes_id, allergies, medications, clinical_notes, created_by, created_at";

const CLINICAL_RECORDS_KEY = ["clinical-records"] as const;

/** Ficha/evolução de um atendimento, em ordem cronológica. */
export function useClinicalRecords(options: {
  appointmentId: string | null;
  enabled: boolean;
}) {
  const { appointmentId, enabled } = options;
  return useQuery<ClinicalRecord[]>({
    queryKey: [...CLINICAL_RECORDS_KEY, { appointmentId }],
    enabled: enabled && appointmentId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinical_records")
        .select(CLINICAL_RECORDS_SELECT)
        .eq("appointment_id", appointmentId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return clinicalRecordListSchema.parse(data);
    },
  });
}

export interface ClinicalRecordInput {
  appointmentId: string;
  customerId: string;
  allergies: string | null;
  medications: string | null;
  clinicalNotes: string | null;
  /**
   * Aponta o registro sucedido. Primeira ficha do atendimento = `null`;
   * correção e nova evolução = id da cabeça da cadeia. Nunca `update`.
   */
  supersedesId: string | null;
}

/** Insere um registro novo (original, correção ou evolução). Append-only. */
export function useCreateClinicalRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClinicalRecordInput) => {
      const { data, error } = await supabase
        .from("clinical_records")
        .insert({
          appointment_id: input.appointmentId,
          customer_id: input.customerId,
          allergies: input.allergies,
          medications: input.medications,
          clinical_notes: input.clinicalNotes,
          supersedes_id: input.supersedesId,
        })
        .select(CLINICAL_RECORDS_SELECT)
        .single();
      if (error) throw error;
      return clinicalRecordRowSchema.parse(data);
    },
    onSuccess: (record) => {
      void queryClient.invalidateQueries({
        queryKey: [...CLINICAL_RECORDS_KEY, { appointmentId: record.appointment_id }],
      });
    },
  });
}

/**
 * Erro de escrita mapeado para pt-BR genérico. Nunca inclui valor de campo,
 * DETAIL ou HINT (dado de saúde não vaza para toast/log).
 */
export function mapClinicalRecordError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  if (code === "42501") {
    return "Sem permissão para salvar o registro clínico.";
  }
  if (code === "23001") {
    return "Registro clínico não pode ser alterado nem apagado.";
  }
  if (code === "23514" || code === "23502" || code === "23503") {
    return "Registro inválido. Verifique os campos e tente de novo.";
  }
  return "Não foi possível salvar o registro. Tente de novo.";
}
