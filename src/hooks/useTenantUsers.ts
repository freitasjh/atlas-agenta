import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { useAuthClaims } from "@/hooks/useAuthClaims";
const ROLES = [
  "super_admin",
  "admin",
  "professional",
  "receptionist",
] as const;

export const tenantUserRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string().nullable(),
  role: z.enum(ROLES),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
  deactivated_at: z.string().nullable().optional(),
});

export const tenantUserListSchema = z.array(tenantUserRowSchema);

export type TenantUser = z.infer<typeof tenantUserRowSchema>;

export const TENANT_USERS_KEY = ["tenant-users"] as const;

const TENANT_USERS_SELECT =
  "id, tenant_id, role, full_name, email, active, created_at, deactivated_at";

/**
 * Perfis do tenant (sob RLS `profiles_select_same_tenant`). Nenhum `tenant_id`
 * é enviado pelo cliente — o RLS garante o isolamento. `admin` vê todos os
 * profiles do próprio tenant; `professional`/`receptionist` veem os do
 * tenant (a trava de papel é no nível de rota/UI, não de leitura).
 */
export function useTenantUsers(options?: { enabled?: boolean }) {
  const claims = useAuthClaims();
  const tenantId = claims?.tenantId ?? null;
  return useQuery<TenantUser[]>({
    queryKey: [...TENANT_USERS_KEY, tenantId],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(TENANT_USERS_SELECT)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return tenantUserListSchema.parse(data ?? []);
    },
  });
}
