import * as React from "react";
import { useSearchParams } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCode } from "lucide-react";

import { PixQrDialog } from "@/app/cobrancas/PixQrDialog";
import { RecebimentosTab } from "@/app/cobrancas/RecebimentosTab";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { useCharges, type Charge, type ChargeStatus } from "@/hooks/useCharges";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import { formatCentsToBRL } from "@/lib/money";

const messages = paymentsMessages.chargesPage;
const STATUS_KEYS = ["todos", "pendente", "pago", "expirado", "cancelado"] as const;

function formatCreatedAt(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return `${formatDateInTenantTz(iso, timeZone)} ${formatTimeInTenantTz(iso, timeZone)}`;
}

export function CobrancasPage() {
  const { tenant } = useCurrentUser();
  const { canViewFinancials } = usePermissions();
  const { payments } = useSegmentFeatures();
  const showReceipts = canViewFinancials && payments === true;
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const [searchParams, setSearchParams] = useSearchParams();
  const aba = showReceipts && searchParams.get("aba") === "recebimentos" ? "recebimentos" : "pix";
  const [status, setStatus] = React.useState<ChargeStatus | "todos">("todos");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [selected, setSelected] = React.useState<Charge | null>(null);

  const chargesQuery = useCharges({
    status,
    from: from || undefined,
    to: to || undefined,
  });

  function setAba(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("aba", next);
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader titulo={messages.title} descricao={messages.description} />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList aria-label={messages.title}>
          <TabsTrigger value="pix" className="min-h-[44px]">{paymentsMessages.receipts.tabPix}</TabsTrigger>
          {showReceipts ? (
            <TabsTrigger value="recebimentos" className="min-h-[44px]">{paymentsMessages.receipts.tabReceipts}</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="pix">
          <PixContent
            status={status}
            onStatusChange={setStatus}
            from={from}
            onFromChange={setFrom}
            to={to}
            onToChange={setTo}
            chargesQuery={chargesQuery}
            timeZone={timeZone}
            onSelect={setSelected}
          />
        </TabsContent>

        {showReceipts ? (
          <TabsContent value="recebimentos">
            <RecebimentosTab messages={paymentsMessages} />
          </TabsContent>
        ) : null}
      </Tabs>

      <PixQrDialog
        charge={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function PixContent({
  status,
  onStatusChange,
  from,
  onFromChange,
  to,
  onToChange,
  chargesQuery,
  timeZone,
  onSelect,
}: {
  status: ChargeStatus | "todos";
  onStatusChange: (value: ChargeStatus | "todos") => void;
  from: string;
  onFromChange: (value: string) => void;
  to: string;
  onToChange: (value: string) => void;
  chargesQuery: ReturnType<typeof useCharges>;
  timeZone: string;
  onSelect: (charge: Charge) => void;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label htmlFor="cobrancas-status">{messages.filters.status}</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                onStatusChange(value as ChargeStatus | "todos")
              }
            >
              <SelectTrigger id="cobrancas-status" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {messages.status[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cobrancas-from">{messages.filters.from}</Label>
            <Input
              id="cobrancas-from"
              type="date"
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cobrancas-to">{messages.filters.to}</Label>
            <Input
              id="cobrancas-to"
              type="date"
              value={to}
              onChange={(event) => onToChange(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {chargesQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chargesQuery.isError ? (
        <StatePanel
          titulo={messages.errorTitle}
          descricao={messages.errorDescription}
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => void chargesQuery.refetch()}
          >
            {messages.retry}
          </Button>
        </StatePanel>
      ) : (chargesQuery.data ?? []).length === 0 ? (
        <StatePanel
          titulo={messages.emptyTitle}
          descricao={messages.emptyDescription}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{messages.table.status}</TableHead>
                <TableHead>{messages.table.value}</TableHead>
                <TableHead>{messages.table.createdAt}</TableHead>
                <TableHead className="text-right">
                  {messages.table.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(chargesQuery.data ?? []).map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell>{messages.status[charge.status]}</TableCell>
                  <TableCell>{formatCentsToBRL(charge.amount_cents)}</TableCell>
                  <TableCell>{formatCreatedAt(charge.created_at, timeZone)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSelect(charge)}
                      className="h-11 min-h-[44px]"
                    >
                      <QrCode className="mr-1 h-4 w-4" aria-hidden="true" />
                      {messages.actionQr}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
