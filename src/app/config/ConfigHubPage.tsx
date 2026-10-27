import { Link } from "react-router-dom";
import {
  Layers,
  MessageCircle,
  MessageSquareText,
  Scissors,
  Users,
  type LucideIcon,
} from "lucide-react";

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
  const { canManageMessageTemplates, canManageCatalog } = usePermissions();
  const { combos: combosFeature } = useSegmentFeatures();
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
    </div>
  );
}
