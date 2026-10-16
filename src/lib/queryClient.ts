import { QueryClient } from "@tanstack/react-query";

/**
 * Instância única do QueryClient (TanStack Query).
 *
 * Montada na raiz da aplicação via `QueryClientProvider` (ADR-04). Todo acesso a
 * dados de servidor passa por aqui — nada de `fetch` solto em `useEffect`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Dados considerados "frescos" por 1 min antes de refetch em background.
      staleTime: 60_000,
      // Retry moderado: 1 nova tentativa em caso de falha transitória.
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
