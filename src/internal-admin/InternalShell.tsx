import * as React from "react";
import {
  BarChart3,
  Building2,
  ClipboardList,
  LayoutDashboard,
  Mail,
  Menu,
  ReceiptText,
} from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Casca da área interna `/internal-admin` (ux-designer, vinculante — paridade
 * com `DashboardShell`, sem redesign): grade `md:grid-cols-[16rem_1fr]`,
 * sidebar com 6 links + Sair, conteúdo `max-w-5xl`, skip-link, foco no `h1`
 * a cada rota. Nunca monta dado de tenant.
 */
export const INTERNAL_ADMIN_NAV_ITEMS: SidebarNavItem[] = [
  { to: "/internal-admin/empresas", label: "Empresas", icon: Building2 },
  { to: "/internal-admin/assinaturas", label: "Assinaturas", icon: ReceiptText },
  { to: "/internal-admin/metricas", label: "Métricas", icon: BarChart3 },
  { to: "/internal-admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/internal-admin/convites", label: "Convites", icon: Mail },
  { to: "/internal-admin/auditoria", label: "Auditoria", icon: ClipboardList },
];

export function InternalShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []);
  const location = useLocation();
  const mainRef = React.useRef<HTMLElement>(null);

  // Foco no h1 a cada rota (leitores de tela anunciam a troca sem redesign).
  React.useEffect(() => {
    const h1 = mainRef.current?.querySelector("h1") as HTMLElement | null;
    if (h1) {
      if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[16rem_1fr]">
      <a
        href="#conteudo-interno"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>
      {/* Sidebar fixa (≥md) */}
      <aside aria-label="Administração interna" className="hidden border-r border-border bg-card md:block">
        <div className="sticky top-0 flex h-screen flex-col gap-6 overflow-y-auto p-4">
          <div className="px-3">
            <Logo />
          </div>
          <SidebarNav items={INTERNAL_ADMIN_NAV_ITEMS} onNavigate={closeMobile} />
          <SignOutButton className="mt-auto min-h-[44px] w-full justify-start" />
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
                  className="min-h-[44px] min-w-[44px] md:hidden"
                  aria-label="Abrir menu de navegação"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-card">
                <SheetHeader className="sr-only">
                  <SheetTitle>Menu de navegação — a administração interna</SheetTitle>
                  <SheetDescription>
                    Navegue pelas seções de a administração interna.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 flex h-full flex-col gap-6">
                  <SidebarNav items={INTERNAL_ADMIN_NAV_ITEMS} onNavigate={closeMobile} />
                  <SignOutButton className="mt-auto min-h-[44px] w-full justify-start" />
                </div>
              </SheetContent>
            </Sheet>
            <span className="md:hidden">
              <Logo iconOnly />
            </span>
          </div>
        </header>

        <main ref={mainRef} id="conteudo-interno" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
