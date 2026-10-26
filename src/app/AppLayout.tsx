import { AppSidebar } from "@/components/AppSidebar";
import { DashboardShell } from "@/components/DashboardShell";
import { useOnboardingSeed } from "@/hooks/useOnboardingSeed";

/**
 * Layout do painel do tenant (`/app`). A casca responsiva (sidebar fixa em
 * ≥768px, Sheet no mobile) vem do `DashboardShell`.
 *
 * Ponto de montagem do onboarding do catálogo-semente por ramo (ADR-06):
 * `useOnboardingSeed` roda aqui porque o layout envolve todas as rotas de
 * `/app` e só renderiza depois que os guards resolveram auth/papel/assinatura
 * — o tenant (e seu `segment`) já está disponível. O hook é inerte para quem
 * não pode gerenciar catálogo e para tenant sem ramo; só age no primeiro
 * acesso do admin com a lista de serviços vazia.
 */
export function AppLayout() {
  useOnboardingSeed();

  return (
    <DashboardShell
      areaLabel="o painel"
      sidebar={({ onNavigate }) => <AppSidebar onNavigate={onNavigate} />}
    />
  );
}
