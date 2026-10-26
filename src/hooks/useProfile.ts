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
 * A linha única é garantida pelo filtro `.eq("id", userId)` — não pelo RLS. A
 * policy `profiles_select_same_tenant` deixa um usuário enxergar TODOS os
 * profiles do seu tenant, então um `.single()` sem esse filtro retorna 406 em
 * tenants com 2+ profiles. O `userId` vem sempre da sessão Supabase autenticada
 * (`id = auth.uid()`), nunca de entrada do cliente, e NÃO é filtro de tenant.
 * Habilitado só quando há sessão.
 */
export function useProfile() {
  const { data: session } = useSession();
  const userId = session?.user.id;

  return useQuery<CurrentProfile>({
    queryKey: ["profile", userId],
    enabled: !!session,
    queryFn: async () => {
      if (!userId) throw new Error("Sessão sem usuário ao ler o profile.");
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, tenant_id")
        .eq("id", userId)
        .single();
      if (error) throw error;
      return profileSchema.parse(data);
    },
  });
}
