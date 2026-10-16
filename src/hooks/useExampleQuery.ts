import { useQuery } from "@tanstack/react-query";

/**
 * Hook de EXEMPLO que fixa a convenção de acesso a dados do Atlas Agenda.
 *
 * Padrão obrigatório do projeto: todo dado de servidor é lido via TanStack
 * Query (`useQuery`/`useMutation`) — NUNCA com `fetch` solto em `useEffect`.
 * O cliente Supabase (`@/lib/supabase`) é a fonte de dados; o RLS no banco
 * garante o isolamento multi-tenant (não filtrar por `tenant_id` no cliente).
 *
 * Esboço do uso real (fase posterior, quando houver tabelas):
 *
 * ```ts
 * import { supabase } from "@/lib/supabase";
 *
 * export function useAppointments() {
 *   return useQuery({
 *     queryKey: ["appointments"],
 *     queryFn: async () => {
 *       const { data, error } = await supabase
 *         .from("appointments")
 *         .select("*");
 *       if (error) throw error;
 *       return data;
 *     },
 *   });
 * }
 * ```
 *
 * Neste recorte (scaffold) o hook fica DESABILITADO (`enabled: false`) para não
 * disparar nenhuma requisição ao Supabase no load — serve só como contrato.
 */
export function useExampleQuery() {
  return useQuery<null>({
    queryKey: ["example"],
    queryFn: async () => null,
    enabled: false,
  });
}
