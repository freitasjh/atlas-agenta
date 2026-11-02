import * as React from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Copy, QrCode } from "lucide-react";

import { useCharges, type Charge, type ChargeStatus } from "@/hooks/useCharges";

const STATUS_LABELS: Record<ChargeStatus | "todos", string> = {
  todos: "Todos",
  pendente: "Pendente",
  pago: "Pago",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

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

export function PixQrDialog({
  charge,
  open,
  onClose,
}: {
  charge: Charge | null;
  open: boolean;
  onClose: () => void;
}) {
  async function copy(text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }
  return (
    <Dialog open={open} onOpenChange={(n) => !n && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>PIX — Copia e cola</DialogTitle>
        </DialogHeader>
        {charge ? (
          <div className="space-y-4">
            {charge.pix_qr_code ? (
              <div className="flex justify-center">
                <img
                  src={
                    charge.pix_qr_code.startsWith("data:")
                      ? charge.pix_qr_code
                      : `data:image/png;base64,${charge.pix_qr_code}`
                  }
                  alt="QR Code PIX"
                  className="h-48 w-48"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">QR Code indisponível.</p>
            )}
            <div className="space-y-2">
              <Label>Código copia-e-cola</Label>
              <div className="flex gap-2">
                <Input readOnly value={charge.pix_copy_paste ?? ""} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void copy(charge.pix_copy_paste)}
                  aria-label="Copiar código"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Expira em: {formatDate(charge.expires_at)}
            </p>
            <p className="text-xs text-muted-foreground">
              Status: {STATUS_LABELS[charge.status]} · Valor: {formatCents(charge.amount_cents)}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CobrancasPage() {
  const [status, setStatus] = React.useState<ChargeStatus | "todos">("todos");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [selected, setSelected] = React.useState<Charge | null>(null);

  const chargesQuery = useCharges({ status, from: from || undefined, to: to || undefined });

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Cobranças"
        descricao="Cobranças PIX pós-atendimento e baixa automática."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ChargeStatus | "todos")}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {chargesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chargesQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar as cobranças"
          descricao="Verifique sua conexão e tente novamente."
        />
      ) : (chargesQuery.data ?? []).length === 0 ? (
        <StatePanel
          titulo="Nenhuma cobrança encontrada"
          descricao="As cobranças PIX aparecerão aqui após a conclusão de agendamentos."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(chargesQuery.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{STATUS_LABELS[c.status]}</TableCell>
                  <TableCell>{formatCents(c.amount_cents)}</TableCell>
                  <TableCell>{formatDate(c.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(c)}
                    >
                      <QrCode className="mr-1 h-4 w-4" />
                      QR
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <PixQrDialog
        charge={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}