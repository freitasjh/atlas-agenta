import * as React from "react";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { EntitlementGate } from "@/components/EntitlementGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useProducts } from "@/hooks/useProducts";
import { useStock, useReplenishStock, useAdjustStock } from "@/hooks/useStock";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { usePermissions } from "@/hooks/usePermissions";
import { stockStatusLabel } from "@/lib/validations/estoque";

interface Row {
  id: string;
  name: string;
  stock_qty: number;
  min_qty: number;
  status: string;
}

function computeStatus(stock_qty: number, min_qty: number): string {
  if (stock_qty <= 0) return "critical";
  if (min_qty > 0 && stock_qty <= Math.floor(min_qty / 2)) return "critical";
  if (stock_qty <= min_qty) return "low";
  return "ok";
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "critical" ? "destructive" : status === "low" ? "secondary" : "default";
  return (
    <Badge variant={variant} className="gap-1">
      <span aria-hidden="true">{status === "critical" ? "⚠" : status === "low" ? "!" : "✓"}</span>
      {stockStatusLabel(status)}
    </Badge>
  );
}

export function EstoquePage() {
  const entitlements = usePlanEntitlements();
  const estoqueEntitled = entitlements?.estoque === true;
  const { isReceptionist, isAdmin } = usePermissions();
  const canOperateStock = isAdmin || isReceptionist;

  const productsQuery = useProducts({ enabled: estoqueEntitled });
  const stockQuery = useStock({ enabled: estoqueEntitled });

  const replenish = useReplenishStock();
  const adjust = useAdjustStock();

  const [replenishOpen, setReplenishOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");

  const products = productsQuery.data ?? [];
  const stockAlerts = stockQuery.data ?? [];

  const rows: Row[] =
    products.length > 0
      ? products.map((p) => ({
          id: p.id,
          name: p.name,
          stock_qty: p.stock_qty,
          min_qty: p.min_qty,
          status: computeStatus(p.stock_qty, p.min_qty),
        }))
      : stockAlerts.map((a) => ({
          id: a.product_id,
          name: a.product_name,
          stock_qty: a.stock_qty,
          min_qty: a.min_qty,
          status: a.status,
        }));

  const criticalCount = rows.filter((r) => r.status === "critical").length;
  const lowCount = rows.filter((r) => r.status === "low").length;

  async function handleReplenishSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const qty = Number(fd.get("qty"));
    const batch = (fd.get("batch") as string) || null;
    const supplier = (fd.get("supplier") as string) || null;
    const unitCost = fd.get("unitCostCents");
    try {
      await replenish.mutateAsync({
        productId: selectedProductId!,
        qty,
        batch,
        supplier,
        unitCostCents: unitCost ? Number(unitCost) : null,
      });
      toast.success("Reposição registrada.");
      setReplenishOpen(false);
    } catch {
      toast.error("Não foi possível registrar a reposição.");
    }
  }

  async function handleAdjustSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await adjust.mutateAsync({
        productId: adjustProductId!,
        qtyDelta: adjustDelta,
        reason: adjustReason,
      });
      toast.success("Ajuste registrado.");
      setAdjustOpen(false);
      setAdjustReason("");
      setAdjustDelta(0);
    } catch {
      toast.error("Não foi possível registrar o ajuste.");
    }
  }

  const isLoading = productsQuery.isLoading && stockQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Estoque"
        descricao="Painel de alertas e movimentações de estoque."
      />

      <EntitlementGate entitled={estoqueEntitled} recurso="Estoque" acaoLabel="Operar estoque">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Críticos</p>
            <p className="text-2xl font-semibold tabular-nums text-destructive" aria-live="polite">
              {criticalCount}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Baixos</p>
            <p className="text-2xl font-semibold tabular-nums" aria-live="polite">
              {lowCount}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Nenhum produto em estoque.</p>
          </div>
        ) : (
          <div className="hidden rounded-lg border border-border md:block">
            <Table>
              <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                Estoque: produto, saldo, mínimo e status de alerta.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Produto</TableHead>
                  <TableHead scope="col">Saldo</TableHead>
                  <TableHead scope="col">Mínimo</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  {canOperateStock ? <TableHead scope="col" className="text-right">Ações</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                    <TableCell className="tabular-nums">{r.stock_qty}</TableCell>
                    <TableCell className="tabular-nums">{r.min_qty}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    {canOperateStock ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedProductId(r.id);
                              setReplenishOpen(true);
                            }}
                          >
                            Repor
                          </Button>
                          {isAdmin ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setAdjustProductId(r.id);
                                setAdjustOpen(true);
                              }}
                            >
                              Ajustar
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Mobile cards */}
        <ul className="space-y-3 md:hidden">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{r.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Saldo: {r.stock_qty} · Mín: {r.min_qty}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {canOperateStock ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedProductId(r.id);
                      setReplenishOpen(true);
                    }}
                  >
                    Repor
                  </Button>
                  {isAdmin ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAdjustProductId(r.id);
                        setAdjustOpen(true);
                      }}
                    >
                      Ajustar
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </EntitlementGate>

      {/* Reposição dialog */}
      <Dialog open={replenishOpen} onOpenChange={setReplenishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reposição de estoque</DialogTitle>
            <DialogDescription>Informe lote, validade, quantidade, custo e fornecedor.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleReplenishSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rep-qty">Quantidade</Label>
              <Input id="rep-qty" name="qty" type="number" min={1} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rep-batch">Lote</Label>
              <Input id="rep-batch" name="batch" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rep-supplier">Fornecedor</Label>
              <Input id="rep-supplier" name="supplier" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rep-cost">Custo unitário (centavos)</Label>
              <Input id="rep-cost" name="unitCostCents" type="number" min={0} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReplenishOpen(false)} disabled={replenish.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={replenish.isPending}>
                {replenish.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Repor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ajuste dialog */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajuste de inventário</DialogTitle>
            <DialogDescription>Motivo obrigatório para o ajuste.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adj-delta">Diferença (pode ser negativa)</Label>
              <Input
                id="adj-delta"
                type="number"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-reason">Motivo</Label>
              <Input
                id="adj-reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjust.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={adjust.isPending || !adjustReason.trim()}>
                {adjust.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Ajustar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}