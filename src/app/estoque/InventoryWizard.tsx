import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProducts } from "@/hooks/useProducts";
import { useAdjustStock } from "@/hooks/useStock";
import { productCategoryLabel } from "@/lib/validations/estoque";

type CountRow = { productId: string; name: string; systemQty: number; counted: number };

export function InventoryWizard({ onDone }: { onDone?: () => void }) {
  const productsQuery = useProducts();
  const adjust = useAdjustStock();
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<string>("all");
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [reason, setReason] = useState("Inventário");

  function startCounting() {
    const list = (productsQuery.data ?? []).filter((p) =>
      category === "all" ? true : p.category === category,
    );
    setCounts(
      list.map((p) => ({
        productId: p.id,
        name: p.name,
        systemQty: p.stock_qty,
        counted: p.stock_qty,
      })),
    );
    setStep(2);
  }

  async function finish() {
    try {
      for (const c of counts) {
        const delta = c.counted - c.systemQty;
        if (delta === 0) continue;
        await adjust.mutateAsync({
          productId: c.productId,
          qtyDelta: delta,
          reason: reason || "Inventário",
        });
      }
      toast.success("Inventário aplicado.");
      onDone?.();
      setStep(1);
      setCounts([]);
    } catch {
      toast.error("Não foi possível aplicar o inventário.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventário — etapa {step} de 2</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="inv-scope">Escopo (categoria)</Label>
              <select
                id="inv-scope"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="backbar">{productCategoryLabel("backbar")}</option>
                <option value="retail">{productCategoryLabel("retail")}</option>
                <option value="both">{productCategoryLabel("both")}</option>
              </select>
            </div>
            <Button onClick={startCounting}>Iniciar contagem</Button>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="inv-reason">Motivo</Label>
              <Input id="inv-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="space-y-3">
              {counts.map((c, idx) => {
                const diff = c.counted - c.systemQty;
                return (
                  <div key={c.productId} className="flex items-center gap-3">
                    <span className="flex-1 text-sm">{c.name}</span>
                    <span className="text-xs text-muted-foreground">Sistema: {c.systemQty}</span>
                    <Input
                      type="number"
                      min={0}
                      value={c.counted}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCounts((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, counted: v } : r)),
                        );
                      }}
                      className="w-24"
                    />
                    {diff !== 0 ? (
                      <span className="text-sm text-amber-600" aria-live="polite">
                        Diff: {diff > 0 ? "+" : ""}
                        {diff}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Voltar
              </Button>
              <Button onClick={finish} disabled={adjust.isPending}>
                {adjust.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Aplicar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}