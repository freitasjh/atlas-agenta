import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { ROLES, type CurrentProfile } from "@/types/domain";
import { useSession } from "@/hooks/useSession";

/**
 * Schema de validação do shape devolvido pelo `profiles`. Dados que vêm do
 * banco são estreitados aqui (sem `any`); `role` é validado contra a união
 * canônica de `types/domain`.
 */
const profileSchema = z.object({
  id: z.string(),
  role: z.enum(ROLES),
  tenant_id: z.string().nullable(),
});

/**
 * Profile do usuário logado (`role`, `tenant_id`).
 *
 * `select` SEM filtro de `tenant_id` no cliente — o RLS devolve apenas a linha
 * do próprio usuário (policy "usuário lê o próprio profile", ADR-03). Habilitado
 * só quando há sessão.
 */
export function useProfile() {
  const { data: session } = useSession();
  const userId = session?.user.id;

  return useQuery<CurrentProfile>({
    queryKey: ["profile", userId],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .single();
      if (error) throw error;
      return profileSchema.parse(data);
    },
  });
}
