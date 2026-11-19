import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
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

import { ProductFormDialog } from "@/app/estoque/ProductFormDialog";
import { useProducts, useCreateProduct, useUpdateProduct, useDeactivateProduct } from "@/hooks/useProducts";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCentsToBRL } from "@/lib/money";
import { productCategoryLabel } from "@/lib/validations/estoque";
import type { Product } from "@/types/domain";
import type { ProductInput } from "@/lib/validations/estoque";

function ProductStatusBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? "default" : "secondary"}>{active ? "Ativo" : "Inativo"}</Badge>;
}

export function ProdutosPage() {
  const entitlements = usePlanEntitlements();
  const estoqueEntitled = entitlements?.estoque === true;
  const { canManageCatalog } = usePermissions();
  const productsQuery = useProducts({ enabled: estoqueEntitled });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deactivateProduct = useDeactivateProduct();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [toToggle, setToToggle] = useState<Product | null>(null);

  const products = productsQuery.data ?? [];

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setFormOpen(true);
  }

  async function handleSubmit(input: ProductInput) {
    try {
      if (editing) {
        await updateProduct.mutateAsync({ id: editing.id, ...input });
        toast.success("Produto atualizado.");
      } else {
        await createProduct.mutateAsync(input);
        toast.success("Produto criado.");
      }
      setFormOpen(false);
      setEditing(null);
    } catch {
      toast.error("Não foi possível salvar o produto. Tente novamente.");
    }
  }

  async function confirmToggle() {
    if (!toToggle) return;
    try {
      await deactivateProduct.mutateAsync({ id: toToggle.id, active: !toToggle.active });
      toast.success(toToggle.active ? "Produto inativado." : "Produto reativado.");
      setToToggle(null);
    } catch {
      toast.error("Não foi possível alterar o produto. Tente novamente.");
    }
  }

  const isPending = createProduct.isPending || updateProduct.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Produtos"
        descricao="Catálogo de produtos de backbar e varejo."
        acoes={
          canManageCatalog && estoqueEntitled ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo produto
            </Button>
          ) : undefined
        }
      />

      <EntitlementGate entitled={estoqueEntitled} recurso="Estoque" acaoLabel="Novo produto">
        {productsQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : productsQuery.isError ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Não foi possível carregar os produtos.</p>
            <Button variant="outline" className="mt-4" onClick={() => void productsQuery.refetch?.()}>
              Tentar novamente
            </Button>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>
            {canManageCatalog && estoqueEntitled ? (
              <Button className="mt-4" onClick={openCreate}>
                <Plus aria-hidden="true" />
                Novo produto
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden rounded-lg border border-border md:block">
              <Table>
                <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                  Produtos: nome, categoria, unidade, custo, preço, estoque e status.
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Nome</TableHead>
                    <TableHead scope="col">Categoria</TableHead>
                    <TableHead scope="col">Unidade</TableHead>
                    <TableHead scope="col">Custo</TableHead>
                    <TableHead scope="col">Preço</TableHead>
                    <TableHead scope="col">Estoque</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    {canManageCatalog ? <TableHead scope="col" className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                      <TableCell>{productCategoryLabel(p.category)}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell className="tabular-nums">{formatCentsToBRL(p.cost_cents)}</TableCell>
                      <TableCell className="tabular-nums">{formatCentsToBRL(p.price_cents)}</TableCell>
                      <TableCell className="tabular-nums">{p.stock_qty}</TableCell>
                      <TableCell>
                        <ProductStatusBadge active={p.active} />
                        {!p.active ? null : p.stock_qty <= 0 ? (
                          <Badge variant="destructive" className="ml-2">Esgotado</Badge>
                        ) : null}
                      </TableCell>
                      {canManageCatalog ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                              <Pencil aria-hidden="true" />
                              Editar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setToToggle(p)}>
                              {p.active ? "Inativar" : "Reativar"}
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {products.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{p.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {productCategoryLabel(p.category)} · {p.unit} · {formatCentsToBRL(p.price_cents)}
                      </p>
                      <p className="text-sm text-muted-foreground">Estoque: {p.stock_qty}</p>
                    </div>
                    <ProductStatusBadge active={p.active} />
                  </div>
                  {canManageCatalog ? (
                    <div className="mt-3 flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        <Pencil aria-hidden="true" />
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setToToggle(p)}>
                        {p.active ? "Inativar" : "Reativar"}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </EntitlementGate>

      {canManageCatalog && estoqueEntitled ? (
        <ProductFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          product={editing}
          onSubmit={handleSubmit}
          isPending={isPending}
        />
      ) : null}

      <Dialog open={!!toToggle} onOpenChange={(o) => { if (!o) setToToggle(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{toToggle?.active ? "Inativar produto" : "Reativar produto"}</DialogTitle>
            <DialogDescription>
              {toToggle?.active
                ? `"${toToggle?.name}" deixa de aparecer para novas vendas.`
                : `"${toToggle?.name}" volta a ficar disponível.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToToggle(null)} disabled={deactivateProduct.isPending}>
              Cancelar
            </Button>
            <Button
              variant={toToggle?.active ? "destructive" : "default"}
              onClick={confirmToggle}
              disabled={deactivateProduct.isPending}
            >
              {deactivateProduct.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {toToggle?.active ? "Inativar" : "Reativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}