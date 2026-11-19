import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuditLog } from "@/hooks/useAuditLog";
import {
  useMembershipCharges,
  useRegularizarAssinatura,
  useReenviarCobrancaAssinatura,
  useUpdateMembershipStatus,
  type AssinaturaLinha,
} from "@/hooks/useMembership";
import { formatCentsToBRL } from "@/lib/money";
import { CancelarAssinaturaDialog } from "@/app/financeiro/assinaturas/CancelarAssinaturaDialog";
import { statusAssinaturaMeta } from "@/app/financeiro/assinaturas/assinaturaMeta";

interface AssinaturaDrawerProps {
  linha: AssinaturaLinha | null;
  aberto: boolean;
  aoAlterarAberto: (aberto: boolean) => void;
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Drawer da assinatura (ADR-05 RF-10): histórico de cobranças do ciclo,
 * auditoria (quem/quando/motivo) e ações pausar/retomar/cancelar-com-motivo/
 * regularizar + reenviar WhatsApp (só com opt-in). Admin-only pela rota.
 */
export function AssinaturaDrawer({ linha, aberto, aoAlterarAberto }: AssinaturaDrawerProps) {
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const subscriptionId = aberto ? (linha?.subscription.id ?? null) : null;

  const cobrancas = useMembershipCharges(subscriptionId, aberto);
  const auditoriaTargetId = aberto ? (linha?.subscription.id ?? null) : null;
  const auditoria = useAuditLog(
    auditoriaTargetId ? { target_id: auditoriaTargetId } : null,
  );

  const atualizar = useUpdateMembershipStatus();
  const regularizar = useRegularizarAssinatura();
  const reenviar = useReenviarCobrancaAssinatura();

  if (!linha) return null;
  const { subscription, planName, planAmountCents, customerName, customerOptIn } = linha;
  const meta = statusAssinaturaMeta[subscription.status];
  const pausada = subscription.status === "pausada";
  const cancelada = subscription.status === "cancelada";
  const inadimplente = subscription.status === "inadimplente";

  const eventos = (auditoria.data ?? []).filter(
    (e) => e.target_id === subscription.id,
  );

  async function executarAcao(acao: "pausar" | "retomar") {
    try {
      await atualizar.mutateAsync({ subscriptionId: subscription.id, acao });
      toast.success(acao === "pausar" ? "Assinatura pausada." : "Assinatura retomada.");
    } catch {
      toast.error("Não foi possível atualizar a assinatura. Tente novamente.");
    }
  }

  async function confirmarCancelamento(motivo: string) {
    try {
      await atualizar.mutateAsync({
        subscriptionId: subscription.id,
        acao: "cancelar",
        motivo,
      });
      setCancelarAberto(false);
      toast.success("Assinatura cancelada.");
    } catch {
      toast.error("Não foi possível atualizar a assinatura. Tente novamente.");
    }
  }

  async function executarRegularizar() {
    try {
      const r = await regularizar.mutateAsync({ subscriptionId: subscription.id });
      toast.success(
        r.duplicada
          ? "Cobrança do ciclo já existe. Nada foi duplicado."
          : "Cobrança PIX do ciclo gerada.",
      );
    } catch {
      toast.error("Não foi possível gerar a cobrança. Tente novamente.");
    }
  }

  async function executarReenvio() {
    try {
      await reenviar.mutateAsync({
        customerId: subscription.customer_id,
        subscriptionId: subscription.id,
        customerOptIn,
      });
      toast.success("Cobrança reenviada no WhatsApp.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível reenviar. Tente novamente.",
      );
    }
  }

  const ocupado = atualizar.isPending || regularizar.isPending || reenviar.isPending;

  return (
    <>
      <Sheet open={aberto} onOpenChange={aoAlterarAberto}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Detalhes da assinatura</SheetTitle>
            <SheetDescription>
              {customerName} · {planName}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={meta.variant}>{meta.rotulo}</Badge>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {formatCentsToBRL(planAmountCents)}
              </span>
              <span className="text-xs text-muted-foreground">
                Próxima cobrança: {formatarData(subscription.next_charge_at)}
              </span>
            </div>

            <Separator />

            <section aria-label="Histórico da assinatura" className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Histórico da assinatura
              </h3>
              {cobrancas.isPending ? (
                <p className="text-sm text-muted-foreground">Carregando cobranças...</p>
              ) : cobrancas.isError ? (
                <p className="text-sm text-muted-foreground" role="alert">
                  Não foi possível carregar as cobranças.
                </p>
              ) : (cobrancas.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma cobrança registrada neste ciclo.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(cobrancas.data ?? []).map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          Ciclo {c.cycle_ref} · {formatCentsToBRL(c.amount_cents)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Vence em {formatarData(c.due_at)}
                          {c.paid_at ? ` · paga em ${formatarData(c.paid_at)}` : ""}
                        </p>
                      </div>
                      <Badge variant={c.status === "pago" ? "default" : "secondary"}>
                        {c.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <Separator />

            <section aria-label="Auditoria" className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Auditoria (quem, quando, motivo)
              </h3>
              {eventos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum evento auditado para esta assinatura.
                </p>
              ) : (
                <ul className="space-y-2">
                  {eventos.slice(0, 20).map((e) => (
                    <li key={e.id} className="rounded-md bg-muted/40 p-3 text-sm">
                      <p className="font-medium text-foreground">{e.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatarData(e.created_at)}
                        {(() => {
                          const meta =
                            typeof e.metadata === "object" && e.metadata !== null
                              ? (e.metadata as Record<string, unknown>)
                              : null;
                          const motivo =
                            meta !== null
                              ? (meta["reason"] ?? meta["motivo"])
                              : null;
                          return typeof motivo === "string" && motivo.trim() !== ""
                            ? ` · motivo: ${motivo}`
                            : "";
                        })()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {!cancelada ? (
            <SheetFooter className="flex-col gap-2 border-t pt-4 sm:flex-col">
              <div className="flex flex-wrap gap-2">
                {!inadimplente ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={ocupado}
                    onClick={() => executarAcao(pausada ? "retomar" : "pausar")}
                  >
                    {atualizar.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {pausada ? "Retomar" : "Pausar"}
                  </Button>
                ) : null}
                {inadimplente ? (
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={ocupado}
                    onClick={executarRegularizar}
                  >
                    {regularizar.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    {regularizar.isPending ? "Gerando..." : "Regularizar"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={ocupado}
                  onClick={() => setCancelarAberto(true)}
                >
                  Cancelar assinatura
                </Button>
              </div>
              <div className="w-full">
                {!customerOptIn ? (
                  <p className="text-xs text-muted-foreground" role="note">
                    Cliente sem consentimento de WhatsApp. Peça o opt-in antes de
                    reenviar a cobrança.
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2 min-h-11 w-full"
                  disabled={ocupado || !customerOptIn}
                  title={
                    customerOptIn
                      ? "Reenviar cobrança no WhatsApp"
                      : "Indisponível sem opt-in do cliente"
                  }
                  onClick={executarReenvio}
                >
                  {reenviar.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {reenviar.isPending ? "Reenviando..." : "Reenviar cobrança"}
                </Button>
              </div>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
      <CancelarAssinaturaDialog
        aberto={cancelarAberto}
        aoAlterarAberto={setCancelarAberto}
        clienteNome={customerName}
        salvando={atualizar.isPending}
        aoConfirmar={confirmarCancelamento}
      />
    </>
  );
}
