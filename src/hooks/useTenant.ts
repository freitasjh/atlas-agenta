import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { SUBSCRIPTION_STATUSES, type CurrentTenant } from "@/types/domain";
import { useProfile } from "@/hooks/useProfile";

/**
 * Schema de validação do shape devolvido pelo `tenants`. `subscription_status`
 * é estreitado contra a união canônica de `types/domain`.
 */
const tenantSchema = z.object({
  id: z.string(),
  trade_name: z.string().nullable(),
  legal_name: z.string().nullable(),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
  timezone: z.string(),
});

/**
 * Tenant do profile (`subscription_status`, `trade_name`, `timezone`).
 *
 * `select` SEM `tenant_id` do cliente — o RLS (via `current_tenant_id()`)
 * garante que só o tenant do usuário volta. `super_admin` não tem `tenant_id`:
 * o hook fica desabilitado e `data` permanece `undefined` (tratado como `null`
 * pelo agregador).
 */
export function useTenant() {
  const { data: profile } = useProfile();
  const tenantId = profile?.tenant_id ?? null;

  return useQuery<CurrentTenant>({
    queryKey: ["tenant", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, trade_name, legal_name, subscription_status, timezone")
        .single();
      if (error) throw error;
      return tenantSchema.parse(data);
    },
  });
}
