import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { crmMessages } from "@/app/clientes/crm-messages";
import { useCustomerMessages } from "@/hooks/useCustomerCrm";

const t = crmMessages.mensagens;

export function CustomerMensagensTab({ customerId }: { customerId: string }) {
  const messagesQuery = useCustomerMessages(customerId);

  if (messagesQuery.isLoading) {
    return <Skeleton className="h-32 w-full" aria-label={t.loading} />;
  }

  if (messagesQuery.isError) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>{t.errorTitle}</CardTitle>
          <CardDescription>{t.errorDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void messagesQuery.refetch()}>
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rows = messagesQuery.data ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.emptyTitle}</CardTitle>
          <CardDescription>{t.emptyDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <caption className="px-4 py-2 text-left text-sm text-muted-foreground">{t.title}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t.colDate}</TableHead>
            <TableHead scope="col">{t.colTemplate}</TableHead>
            <TableHead scope="col">{t.colStatus}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums">
                {new Date(row.createdAt).toLocaleString("pt-BR")}
              </TableCell>
              <TableCell className="font-medium text-foreground">{row.template}</TableCell>
              <TableCell>
                <Badge variant="outline">{row.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
