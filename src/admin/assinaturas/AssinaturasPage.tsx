import * as React from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Copy } from "lucide-react";

import { useAdminTenants } from "@/hooks/useAdminTenants";
import {
  useCreateSubscriptionCharge,
  useSubscriptionCharges,
  type SubscriptionCharge,
} from "@/hooks/useSubscriptionCharges";
import { PLANS } from "@/lib/plans";
import type { TenantListItem } from "@/types/domain";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

export function AssinaturasPage() {
  const tenantsQuery = useAdminTenants();
  const chargesQuery = useSubscriptionCharges();
  const createMutation = useCreateSubscriptionCharge();

  const [tenantId, setTenantId] = React.useState("");
  const [plan, setPlan] = React.useState("individual");
  const [result, setResult] = React.useState<{
    pix_qr_code?: string | null;
    pix_copy_paste?: string | null;
    expires_at?: string;
  } | null>(null);

  const tenants = tenantsQuery.data ?? [];

  React.useEffect(() => {
    if (!tenantId && tenants.length > 0) setTenantId(tenants[0].id);
  }, [tenants, tenantId]);

  async function handleGenerate() {
    if (!tenantId) {
      toast.error("Selecione um tenant.");
      return;
    }
    try {
      const res = await createMutation.mutateAsync({
        tenant_id: tenantId,
        plan,
        billing_period: "monthly",
      });
      setResult(res);
      toast.success("Cobrança gerada.");
    } catch (e) {
      toast.error("Não foi possível gerar a cobrança.");
    }
  }

  async function copy(text: string | null | undefined) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Assinaturas"
        descricao="Cobranças de assinatura PIX para tenants."
      />

      <Card>
        <CardHeader>
          <CardTitle>Gerar cobrança de assinatura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Tenant</Label>
            {tenantsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t: TenantListItem) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.trade_name ?? t.legal_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Plano</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLANS.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Cobrança mensal. Não há plano anual — o valor é o preço mensal do
            plano em <code>supabase/functions/_shared/plans.json</code>.
          </p>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Gerando…" : "Gerar cobrança PIX"}
          </Button>

          {result ? (
            <div className="space-y-3 rounded-md border p-4">
              {result.pix_qr_code ? (
                <div className="flex justify-center">
                  <img
                    src={
                      result.pix_qr_code.startsWith("data:")
                        ? result.pix_qr_code
                        : `data:image/png;base64,${result.pix_qr_code}`
                    }
                    alt="QR Code PIX"
                    className="h-40 w-40"
                  />
                </div>
              ) : null}
              <div className="flex gap-2">
                <Input readOnly value={result.pix_copy_paste ?? ""} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void copy(result.pix_copy_paste)}
                  aria-label="Copiar"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expira em: {formatDate(result.expires_at ?? null)}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobranças de assinatura</CardTitle>
        </CardHeader>
        <CardContent>
          {chargesQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (chargesQuery.data ?? []).length === 0 ? (
            <StatePanel
              titulo="Nenhuma cobrança"
              descricao="As cobranças de assinatura aparecerão aqui."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(chargesQuery.data ?? []).map((c: SubscriptionCharge) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.tenant_id.slice(0, 8)}</TableCell>
                    <TableCell>{c.plan ?? "—"}</TableCell>
                    <TableCell>{STATUS_LABELS[c.status] ?? c.status}</TableCell>
                    <TableCell>{formatCents(c.amount_cents)}</TableCell>
                    <TableCell>{formatDate(c.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}