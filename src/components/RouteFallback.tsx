import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de rota cheia enquanto a cadeia sessão → profile → tenant resolve.
 * Compartilhado pelos guards (`RequireAuth`, `RequireRole`,
 * `RequireActiveSubscription`) para evitar divergência. Evita o "flash de
 * login": sem sessão confirmada, mostramos carregamento, não a tela pública.
 *
 * É `aria-hidden` de propósito: carregamento transitório não deve poluir a
 * árvore de acessibilidade.
 */
export function RouteFallback() {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-6" aria-hidden="true">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
