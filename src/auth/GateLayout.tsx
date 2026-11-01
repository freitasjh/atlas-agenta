import { Link, Outlet } from "react-router-dom";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Casca das telas de bloqueio autenticado (ADR-10): coluna única centrada,
 * com a marca e o alternador de tema. Sem `aside` de apresentação e sem menu —
 * quem está aqui ainda não pode navegar no painel.
 *
 * O conteúdo (`<Outlet />`) fica limitado a `max-w-md`, o mesmo recorte do
 * card de autenticação, para a tela de troca não alargar em desktops.
 */
export function GateLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Link
          to="/"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Atlas Agenda — início"
        >
          <Logo />
        </Link>
        <ThemeToggle />
      </header>

      {/* `<div>`, não `<main>`: `RootLayout` já isola o conteúdo num
          `<main id="conteudo">` (alvo do skip-link). Um segundo landmark
          `main` dentro dele é inválido e quebra a navegação por região. */}
      <div className="flex justify-center px-4 pb-12 pt-6 sm:px-6 sm:pt-10">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
