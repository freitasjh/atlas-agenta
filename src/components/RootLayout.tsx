import { Outlet } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queryClient";

/**
 * Raiz da árvore de rotas. Monta os provedores globais (tema dark por padrão
 * e TanStack Query), o skip-link de acessibilidade e o Toaster (sonner).
 *
 * O `<main id="conteudo">` é o alvo do skip-link; cada área renderiza seu
 * próprio layout dentro do `<Outlet/>`.
 */
export function RootLayout() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          Pular para o conteúdo
        </a>
        <main id="conteudo">
          <Outlet />
        </main>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
