import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useProductProfessionals } from "@/hooks/useProducts";
import {
  productInputSchema,
  type ProductInput,
  productCategoryLabel,
} from "@/lib/validations/estoque";
import { formatCentsToBRL } from "@/lib/money";
import type { Product } from "@/types/domain";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSubmit: (input: ProductInput) => Promise<void>;
  isPending: boolean;
}

const defaultValues: ProductInput = {
  name: "",
  sku: null,
  category: "backbar",
  unit: "un",
  costCents: 0,
  priceCents: 0,
  minQty: 0,
  active: true,
  commissionPct: 0,
  professionalIds: [],
};

export function ProductFormDialog({ open, onOpenChange, product, onSubmit, isPending }: Props) {
  const { data: professionals = [] } = useProfessionals();
  const { data: productProfessionals = [] } = useProductProfessionals(product?.id ?? null);
  const form = useForm<ProductInput>({
    resolver: zodResolver(productInputSchema),
    defaultValues,
  });

  useEffect(() => {
    if (open) {
      if (product) {
        form.reset({
          name: product.name,
          sku: product.sku,
          category: product.category,
          unit: product.unit,
          costCents: product.cost_cents,
          priceCents: product.price_cents,
          minQty: product.min_qty,
          active: product.active,
          commissionPct: product.commission_pct,
          professionalIds: productProfessionals.map((pp) => pp.professional_id),
        });
      } else {
        form.reset(defaultValues);
      }
    }
  }, [open, product, productProfessionals, form]);

  async function handleSubmit(values: ProductInput) {
    await onSubmit(values);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            Cadastre o produto do catálogo de backbar/varejo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prod-name">Nome</Label>
            <Input id="prod-name" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-sku">SKU</Label>
              <Input id="prod-sku" {...form.register("sku")} />
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select
                value={form.watch("category")}
                onValueChange={(v) => form.setValue("category", v as ProductInput["category"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backbar">{productCategoryLabel("backbar")}</SelectItem>
                  <SelectItem value="retail">{productCategoryLabel("retail")}</SelectItem>
                  <SelectItem value="both">{productCategoryLabel("both")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-unit">Unidade</Label>
              <Input id="prod-unit" {...form.register("unit")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-min">Estoque mínimo</Label>
              <Input id="prod-min" type="number" {...form.register("minQty", { valueAsNumber: true })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-cost">Custo (centavos)</Label>
              <Input id="prod-cost" type="number" {...form.register("costCents", { valueAsNumber: true })} />
              <p className="text-xs text-muted-foreground">{formatCentsToBRL(form.watch("costCents") || 0)}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-price">Preço venda (centavos)</Label>
              <Input id="prod-price" type="number" {...form.register("priceCents", { valueAsNumber: true })} />
              <p className="text-xs text-muted-foreground">{formatCentsToBRL(form.watch("priceCents") || 0)}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-comm">Comissão (%)</Label>
            <Input id="prod-comm" type="number" step="0.01" {...form.register("commissionPct", { valueAsNumber: true })} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.watch("active")} onCheckedChange={(v) => form.setValue("active", v)} />
            <Label>Ativo</Label>
          </div>
          {professionals.length > 0 ? (
            <div className="space-y-2">
              <Label>Profissionais vinculados</Label>
              <div className="flex flex-wrap gap-2">
                {professionals.map((p) => {
                  const selected = form.watch("professionalIds")?.includes(p.id) ?? false;
                  return (
                    <Button
                      key={p.id}
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      onClick={() => {
                        const current = form.getValues("professionalIds") ?? [];
                        if (selected) {
                          form.setValue(
                            "professionalIds",
                            current.filter((x) => x !== p.id),
                          );
                        } else {
                          form.setValue("professionalIds", [...current, p.id]);
                        }
                      }}
                    >
                      {p.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}