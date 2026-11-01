import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import {
  BUSINESS_SEGMENTS,
  SUBSCRIPTION_STATUSES,
  type CurrentTenant,
} from "@/types/domain";
import { useAuthClaims } from "@/hooks/useAuthClaims";

/**
 * Schema de validação do shape devolvido pelo `tenants`. `subscription_status`
 * é estreitado contra a união canônica de `types/domain`.
 */
export const tenantSchema = z.object({
  id: z.string(),
  trade_name: z.string().nullable(),
  legal_name: z.string().nullable(),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
  timezone: z.string(),
  // Valor inesperado do banco degrada para `null` (genérico) em vez de
  // derrubar o parse do tenant — nunca transforma dado sujo em negação de acesso.
  segment: z.enum(BUSINESS_SEGMENTS).nullable().catch(null),
});

/**
 * Tenant do usuário (`subscription_status`, `trade_name`, `timezone`).
 *
 * O `tenantId` vem da claim `tenant_id` do JWT (ADR-07) — só habilita a query.
 * O `select` continua SEM `tenant_id` do cliente: o RLS (via
 * `current_tenant_id()`) garante que só o tenant do usuário volta.
 * `super_admin` não tem `tenant_id`: o hook fica desabilitado e `data`
 * permanece `undefined` (tratado como `null` pelo agregador).
 */
export function useTenant() {
  const claims = useAuthClaims();
  const tenantId = claims?.tenantId ?? null;

  return useQuery<CurrentTenant>({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, trade_name, legal_name, subscription_status, timezone, segment",
        )
        .single();
      if (error) throw error;
      return tenantSchema.parse(data);
    },
  });
}
