import { Link, NavLink, Outlet } from "react-router-dom";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MARKETING_LINKS = [
  { to: "/precos", label: "Preços" },
  { to: "/termos", label: "Termos" },
];

/**
 * Layout das rotas públicas (marketing): header com a marca + navegação e
 * footer. Mobile-first, landmarks semânticas.
 */
export function MarketingLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Atlas Agenda — início"
          >
            <Logo />
          </Link>
          <nav
            aria-label="Navegação do site"
            className="flex items-center gap-1 sm:gap-2"
          >
            {MARKETING_LINKS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
            <Button asChild variant="outline" size="sm">
              <Link to="/login">Entrar</Link>
            </Button>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <Outlet />
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <p>© {new Date().getFullYear()} Atlas Agenda. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
