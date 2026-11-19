import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  mergeCatalogWithFallback,
  planCatalogRowSchema,
  type Plan,
} from "@/lib/plans";

/**
 * Catálogo de planos via RPC `get_plans()` (SSoT `public.plans`).
 *
 * Cache: `staleTime` 5min / `gcTime` 30min — catálogo quase estático, sem
 * refetch agressivo. Fallback: se a RPC falhar ou voltar vazia, a query
 * resolve com o fallback estático de `src/lib/plans.ts` (paridade travada por
 * teste), então a UI nunca quebra por indisponibilidade do catálogo.
 */

export const PLANS_CATALOG_KEY = ["plans", "catalog"] as const;

const catalogRowsSchema = z.array(planCatalogRowSchema);

async function fetchPlansCatalog(): Promise<Plan[]> {
  try {
    const { data, error } = await supabase.rpc("get_plans");
    if (error) {
      console.warn("[plans-catalog]", error);
      return mergeCatalogWithFallback(null);
    }
    const rows = catalogRowsSchema.parse(data);
    return mergeCatalogWithFallback(rows);
  } catch (e) {
    console.warn("[plans-catalog]", e);
    return mergeCatalogWithFallback(null);
  }
}

export function usePlansCatalog() {
  return useQuery<Plan[]>({
    queryKey: PLANS_CATALOG_KEY,
    queryFn: fetchPlansCatalog,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });
}
