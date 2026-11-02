import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Scissors,
  type LucideIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link as LinkIcon, Copy } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { cn } from "@/lib/utils";

interface ConfigShortcut {
  to: string;
  titulo: string;
  descricao: string;
  icon: LucideIcon;
  visible?: boolean;
}

export function ConfigHubPage() {
  const { canManageCatalog, isAdmin } = usePermissions();
  const { data: bookingLink } = null as any;
  const createLink = { mutate: () => {}, isPending: false } as any;
  const tenants = [] as any;
  const [selectedTenant, setSelectedTenant] = useState<string>("");

  function handleCopyLink() {
    if (!bookingLink?.token) return;
    const url = `${window.location.origin}/agendar/${bookingLink.token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  }

  function handleCreateLink() {
    const tenantId = isAdmin && tenants?.length ? (selectedTenant || tenants[0]?.id) : undefined;
    createLink.mutate(tenantId, {
      onSuccess: () => toast.success("Link gerado com sucesso!"),
      onError: (err: any) => toast.error(err?.message || "Erro ao gerar link"),
    });
  }

  const { servicosLabel } = useSegmentTerms();

  const shortcuts: ConfigShortcut[] = [
    {
      to: "/app/config/servicos",
      titulo: servicosLabel,
      descricao: "Catalogo de servicos oferecidos",
      icon: Scissors,
      visible: canManageCatalog,
    },
  ];

  return (
    <div className="p-6">
      <PageHeader titulo="Configuracoes" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shortcuts
          .filter((shortcut) => shortcut.visible !== false)
          .map((shortcut) => (
            <Link
              key={shortcut.to}
              to={shortcut.to}
              className={cn(
                "group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <shortcut.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{shortcut.titulo}</CardTitle>
                  <CardDescription>{shortcut.descricao}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
      </div>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                <div>
                  <CardTitle>Agendamento Publico</CardTitle>
                  <CardDescription>Link para clientes agendarem sozinhos</CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                {isAdmin && tenants && tenants.length > 0 && (
                  <Select value={selectedTenant || tenants[0]?.id} onValueChange={setSelectedTenant}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Selecione empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.trade_name || t.name || "Empresa"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {bookingLink && (
                  <Button variant="outline" size="sm" onClick={handleCopyLink}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar link
                  </Button>
                )}
                <Button size="sm" onClick={handleCreateLink} disabled={createLink.isPending}>
                  {createLink.isPending ? "Gerando..." : bookingLink ? "Gerar novo link" : "Gerar link"}
                </Button>
              </div>
            </div>
            {bookingLink && (
              <div className="mt-2 p-2 bg-muted rounded text-sm break-all">
                {window.location.origin}/agendar/{bookingLink.token}
              </div>
            )}
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
