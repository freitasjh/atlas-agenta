import { Link } from "react-router-dom";
import {
  Layers,
  Mail,
  MessageCircle,
  MessageSquareText,
  Scissors,
  Users,
  Copy,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";
import { usePublicBookingLink, useCreatePublicBookingLink } from "@/hooks/usePublicBookingLink";
import { useAdminTenants } from "@/hooks/useAdminTenants";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { cn } from "@/lib/utils";

interface ConfigShortcut {
  to: string;
  titulo: string;
  descricao: string;
  icon: LucideIcon;
  /** Só aparece quando `true`; `undefined` = sempre visível. */
  visible?: boolean;
}

/**
 * Hub de Configurações (`/app/config`). Substitui a casca anterior por atalhos
 * para as áreas do cadastro operacional. As rotas de profissionais e grade
 * chegam nas ADRs seguintes; o atalho de Profissionais já aponta para o destino.
 */
export function ConfigHubPage() {
  const { canManageMessageTemplates, canManageCatalog, isAdmin } = usePermissions();
  const { combos: combosFeature } = useSegmentFeatures();
  const { data: bookingLink } = usePublicBookingLink();
  const createLink = useCreatePublicBookingLink();
  const { data: tenants } = useAdminTenants();
  const [selectedTenant, setSelectedTenant] = useState<string>("");

  function handleCopyLink() {
    if (!bookingLink?.token) return;
    const url = `${window.location.origin}/agendar/${bookingLink.token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  }

  function handleCreateLink() {
    createLink.mutate(isAdmin && tenants?.length ? selectedTenant || tenants[0]?.id : undefined, {
      onSuccess: () => toast.success("Link gerado com sucesso!"),
      onError: (err: any) => toast.error(err?.message || "Erro ao gerar link"),
    });
  }
  const { servicosLabel, profissionaisLabel } = useSegmentTerms();

  const shortcuts: ConfigShortcut[] = [
    {
      to: "/app/config/servicos",
      titulo: servicosLabel,
      descricao: "O que você oferece: nome, duração, preço e quem executa.",
      icon: Scissors,
    },
    {
      to: "/app/config/combos",
      titulo: "Pacotes",
      descricao:
        "Combine procedimentos num preço fechado para seus clientes.",
      icon: Layers,
      visible: combosFeature && canManageCatalog,
    },
    {
      to: "/app/config/profissionais",
      titulo: profissionaisLabel,
      descricao: "Quem atende na sua empresa e os horários de cada um.",
      icon: Users,
    },
    {
      to: "/app/config/whatsapp",
      titulo: "WhatsApp",
      descricao: "Conecte o número que fala com seus clientes.",
      icon: MessageCircle,
    },
    {
      to: "/app/config/mensagens",
      titulo: "Modelos de mensagem",
      descricao: "Os textos que seus clientes recebem no WhatsApp.",
      icon: MessageSquareText,
      visible: canManageMessageTemplates,
    },
    {
      to: "/app/config/membros",
      titulo: "Membros",
      descricao: "Convide pessoas para a sua empresa e gerencie convites.",
      icon: Mail,
      visible: isAdmin,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Configurações"
        descricao="O alicerce da sua operação: serviços, equipe e horários."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {shortcuts
          .filter((shortcut) => shortcut.visible !== false)
          .map(({ to, titulo, descricao, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader>
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <CardTitle>{titulo}</CardTitle>
                <CardDescription>{descricao}</CardDescription>
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
                  <CardTitle>Agendamento Público</CardTitle>
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
                        <SelectItem key={t.id} value={t.id}>{t.trade_name || t.id}</SelectItem>
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
