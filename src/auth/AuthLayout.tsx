import { Check } from "lucide-react";
import { Link, Outlet } from "react-router-dom";

import { BrandIllustration } from "@/marketing/BrandIllustration";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Funcionalidades do produto, resumidas no painel de login (RF14, CA10). */
const AUTH_HIGHLIGHTS = [
  "Agenda sem conflito por profissional",
  "Confirmação automática 24h antes",
  "Cobrança por PIX ao fim do atendimento",
  "Baixa automática do pagamento",
] as const;

/**
 * Layout das rotas de autenticação: card centralizado com split visual.
 * Em ≥1024px, uma coluna de apresentação acompanha o card de formulário.
 */
export function AuthLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* Painel de apresentação (apenas em telas largas). */}
      <aside className="hidden flex-col justify-between bg-card p-10 lg:flex">
        <div className="space-y-8">
          <Logo />
          <BrandIllustration variant="aside" className="max-w-xs" />
        </div>
        <div className="space-y-4">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Agenda e cobrança, sem no-show.
          </h2>
          <ul className="space-y-2.5">
            {AUTH_HIGHLIGHTS.map((highlight) => (
              <li
                key={highlight}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:min-h-0">
        <header className="flex items-center justify-between px-4 py-3 sm:px-6 lg:justify-end">
          <Link
            to="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
            aria-label="Atlas Agenda — início"
          >
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
