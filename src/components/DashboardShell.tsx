import * as React from "react";
import { Menu } from "lucide-react";
import { Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface DashboardShellProps {
  /**
   * Conteúdo da sidebar. Recebe `onNavigate` para fechar o Sheet no mobile
   * quando um item é clicado.
   */
  sidebar: (props: { onNavigate: () => void }) => React.ReactNode;
  /** Rótulo da área, exibido no topbar mobile e no título do Sheet. */
  areaLabel: string;
}

/**
 * Casca responsiva compartilhada por `/app` e `/admin`.
 *
 * - Em ≥768px (md): sidebar fixa à esquerda, conteúdo à direita.
 * - No mobile: sidebar vira um `Sheet` acionado por botão de menu acessível.
 *
 * Mobile-first: estiliza o layout pequeno primeiro, depois o breakpoint md.
 */
export function DashboardShell({ sidebar, areaLabel }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []);

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[16rem_1fr]">
      {/* Sidebar fixa (≥md) */}
      <aside className="hidden border-r border-border bg-card md:block">
        <div className="sticky top-0 h-screen overflow-y-auto p-4">
          {sidebar({ onNavigate: closeMobile })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Topbar: botão de menu só no mobile */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Abrir menu de navegação"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-card">
                <SheetHeader className="sr-only">
                  <SheetTitle>Menu de navegação — {areaLabel}</SheetTitle>
                  <SheetDescription>
                    Navegue pelas seções de {areaLabel}.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6">
                  {sidebar({ onNavigate: closeMobile })}
                </div>
              </SheetContent>
            </Sheet>
            {/* Marca no topbar mobile (sidebar está escondida) */}
            <span className="md:hidden">
              <Logo iconOnly />
            </span>
          </div>
          <ThemeToggle />
        </header>

        <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
