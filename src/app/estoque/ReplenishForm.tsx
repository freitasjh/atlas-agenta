import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProducts } from "@/hooks/useProducts";
import { useReplenishStock } from "@/hooks/useStock";
import { toast } from "sonner";
import type { ReplenishInput } from "@/lib/validations/estoque";

export function ReplenishForm({ onDone }: { onDone?: () => void }) {
  const productsQuery = useProducts();
  const replenish = useReplenishStock();
  const [productId, setProductId] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: ReplenishInput = {
      productId,
      qty: Number(fd.get("qty")),
      batch: (fd.get("batch") as string) || null,
      expiresAt: (fd.get("expiresAt") as string) || null,
      supplier: (fd.get("supplier") as string) || null,
      unitCostCents: fd.get("unitCostCents") ? Number(fd.get("unitCostCents")) : null,
    };
    try {
      await replenish.mutateAsync(input);
      toast.success("Reposição registrada.");
      onDone?.();
    } catch {
      toast.error("Não foi possível registrar a reposição.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reposição de estoque</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rf-product">Produto</Label>
            <select
              id="rf-product"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
            >
              <option value="">Selecione</option>
              {(productsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rf-qty">Quantidade</Label>
            <Input id="rf-qty" name="qty" type="number" min={1} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rf-batch">Lote</Label>
            <Input id="rf-batch" name="batch" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rf-expires">Validade</Label>
            <Input id="rf-expires" name="expiresAt" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rf-supplier">Fornecedor</Label>
            <Input id="rf-supplier" name="supplier" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rf-cost">Custo unitário (centavos)</Label>
            <Input id="rf-cost" name="unitCostCents" type="number" min={0} />
          </div>
          <Button type="submit" disabled={replenish.isPending || !productId}>
            {replenish.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Repor
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}