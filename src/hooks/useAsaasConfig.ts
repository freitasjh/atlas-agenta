import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";

/**
 * Hooks de dados da configuração Asaas por tenant (ADR-20). A API key nunca é
 * lida pelo cliente (criptografada no banco, service role escreve); o frontend
 * só lê metadados seguros (account_id, environment, active). Operações
 * privilegiadas vão pelas Edge Functions `test-asaas-connection` e
 * `save-asaas-config`.
 */

export const ASAAS_ENVIRONMENTS = ["sandbox", "production"] as const;
export type AsaasEnvironment = (typeof ASAAS_ENVIRONMENTS)[number];

export const asaasConfigRowSchema = z.object({
  tenant_id: z.string(),
  asaas_account_id: z.string().nullable(),
  environment: z.enum(ASAAS_ENVIRONMENTS),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type TenantAsaasConfig = z.infer<typeof asaasConfigRowSchema>;

export const ASAAS_CONFIG_KEY = ["asaas", "config"] as const;

const ASAAS_CONFIG_SELECT =
  "tenant_id, asaas_account_id, environment, active, created_at, updated_at";

const testConnectionResponseSchema = z.object({
  ok: z.boolean(),
  account_id: z.string().optional(),
  name: z.string().optional(),
});

const saveConfigResponseSchema = z.object({
  ok: z.boolean(),
  webhook_token: z.string().optional(),
  account_id: z.string().optional(),
});

export const testAsaasConnectionInputSchema = z.object({
  apiKey: z.string().min(1),
  environment: z.enum(ASAAS_ENVIRONMENTS).default("sandbox"),
});

export const saveAsaasConfigInputSchema = z.object({
  apiKey: z.string().min(1),
  environment: z.enum(ASAAS_ENVIRONMENTS).default("sandbox"),
});

export type TestAsaasConnectionInput = z.infer<typeof testAsaasConnectionInputSchema>;
export type SaveAsaasConfigInput = z.infer<typeof saveAsaasConfigInputSchema>;

async function readAsaasConfig(): Promise<TenantAsaasConfig | null> {
  const { data, error } = await supabase
    .from("tenant_asaas_config")
    .select(ASAAS_CONFIG_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (data === null) return null;
  return asaasConfigRowSchema.parse(data);
}

export function useAsaasConfig() {
  return useQuery<TenantAsaasConfig | null>({
    queryKey: ASAAS_CONFIG_KEY,
    queryFn: readAsaasConfig,
  });
}

export function useTestAsaasConnection() {
  return useMutation({
    mutationFn: async (input: TestAsaasConnectionInput) => {
      const parsed = testAsaasConnectionInputSchema.parse(input);
      const { data, error } = await supabase.functions.invoke(
        "test-asaas-connection",
        {
          body: { apiKey: parsed.apiKey, environment: parsed.environment },
        },
      );
      if (error) throw error;
      return testConnectionResponseSchema.parse(data);
    },
  });
}

export function useSaveAsaasConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveAsaasConfigInput) => {
      const parsed = saveAsaasConfigInputSchema.parse(input);
      const { data, error } = await supabase.functions.invoke(
        "save-asaas-config",
        {
          body: { apiKey: parsed.apiKey, environment: parsed.environment },
        },
      );
      if (error) throw error;
      return saveConfigResponseSchema.parse(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ASAAS_CONFIG_KEY });
    },
  });
}