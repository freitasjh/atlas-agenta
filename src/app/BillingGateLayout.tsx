import type { ReactNode } from "react";

import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card } from "@/components/ui/card";

interface BillingGateLayoutProps {
  children: ReactNode;
}

/**
 * Layout enxuto dos estados de assinatura (quitação / conta cancelada). Reusa a
 * estética centrada do `AuthLayout` — `Logo`, `ThemeToggle` e um único `Card` —
 * mas SEM a sidebar do `DashboardShell`: o usuário bloqueado/cancelado não deve
 * navegar pelos módulos operacionais.
 *
 * É uma rota autenticada (fica sob `RequireAuth`), mas fora do guard de
 * assinatura para não gerar loop de redirect (ver `src/router.tsx`).
 */
export function BillingGateLayout({ children }: BillingGateLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <Card className="w-full max-w-md p-8">{children}</Card>
      </main>
    </div>
  );
}
