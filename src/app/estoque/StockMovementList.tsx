import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStockMovements } from "@/hooks/useStock";

export function StockMovementList({ productId }: { productId: string | null }) {
  const [open, setOpen] = useState(false);
  const movementsQuery = useStockMovements(open ? productId : null);

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Ocultar movimentações" : "Ver movimentações"}
      </Button>
      {open ? (
        <div className="rounded-lg border border-border">
          <Table>
            <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
              Movimentações de estoque deste produto.
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Tipo</TableHead>
                <TableHead scope="col">Qtd</TableHead>
                <TableHead scope="col">Motivo</TableHead>
                <TableHead scope="col">Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(movementsQuery.data ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.movement_type}</TableCell>
                  <TableCell className="tabular-nums">{m.qty_delta}</TableCell>
                  <TableCell>{m.reason ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{new Date(m.created_at).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}