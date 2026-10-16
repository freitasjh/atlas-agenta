import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** `end` para casar a rota exata (ex.: índice da área). */
  end?: boolean;
}

interface SidebarNavProps {
  items: SidebarNavItem[];
  /** Chamado ao clicar num item (ex.: fechar o Sheet no mobile). */
  onNavigate?: () => void;
}

/**
 * Lista de navegação compartilhada pelas sidebars de `/app` e `/admin`.
 * Marca o item ativo com `aria-current="page"` (acessibilidade).
 */
export function SidebarNav({ items, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
              {isActive ? <span className="sr-only">(página atual)</span> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
