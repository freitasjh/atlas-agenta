import { Link } from "react-router-dom";
import { CalendarCheck, MessageCircle, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Páginas da área de marketing (ADR-05). A landing é a única superfície com
 * conteúdo real nesta fase; `/precos` e `/termos` são cascas em pt-BR.
 */

/**
 * Landing: a tese do produto abre o hero — confirmar o agendamento para
 * derrubar o no-show. A assinatura visual é o "anel de confirmação" do Logo
 * ecoado na transição de estado `pendente → confirmado`.
 */
export function LandingPage() {
  return (
    <div className="space-y-16">
      <section className="flex flex-col items-start gap-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <CalendarCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          Agenda + cobrança num só lugar
        </span>

        <h1 className="max-w-3xl font-display text-[clamp(1.75rem,5vw,2.75rem)] font-semibold leading-tight tracking-tight">
          Confirme cada horário e receba na hora, direto pelo WhatsApp.
        </h1>

        <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
          O Atlas Agenda confirma seus agendamentos 24h antes, lembra o cliente
          e cobra por PIX assim que o atendimento termina. Menos faltas, menos
          corrida atrás de pagamento.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/cadastro">Começar agora</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/precos">Ver planos</Link>
          </Button>
        </div>

        <div
          className="flex flex-wrap items-center gap-2 pt-2"
          aria-label="Exemplo: um agendamento confirmado pelo cliente"
        >
          <StatusBadge status="pendente" />
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <StatusBadge status="confirmado" />
          <span className="text-sm text-muted-foreground">
            lembrete D-1 confirmado pelo cliente
          </span>
        </div>
      </section>

      <section aria-labelledby="como-funciona" className="space-y-6">
        <h2
          id="como-funciona"
          className="font-display text-2xl font-semibold tracking-tight"
        >
          Como o Atlas Agenda trabalha por você
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            titulo="Agenda sem conflito"
            descricao="Grade por profissional com prevenção de sobreposição. Cada horário fica reservado só uma vez."
          />
          <Feature
            icon={<MessageCircle className="h-5 w-5" aria-hidden="true" />}
            titulo="Confirmação automática"
            descricao="Mensagem de lembrete 24h antes. O cliente confirma com um toque e o no-show cai."
          />
          <Feature
            icon={<QrCode className="h-5 w-5" aria-hidden="true" />}
            titulo="Cobrança por PIX"
            descricao="QR Code e copia e cola enviados após o atendimento, com baixa automática do pagamento."
          />
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  titulo,
  descricao,
}: {
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-primary">
        {icon}
      </span>
      <h3 className="font-display text-base font-semibold">{titulo}</h3>
      <p className="text-sm text-muted-foreground">{descricao}</p>
    </div>
  );
}

const PLANOS = [
  {
    nome: "Individual",
    publico: "Autônomo",
    destaques: [
      "1 profissional",
      "Até 150 agendamentos por mês",
      "Régua de mensagens padrão",
    ],
  },
  {
    nome: "Clínica",
    publico: "Equipe",
    destaques: [
      "Até 5 profissionais",
      "Agendamentos ilimitados",
      "Mensagens personalizadas e taxa de reserva configurável",
    ],
  },
  {
    nome: "Pro",
    publico: "Multi-profissionais",
    destaques: [
      "Mais de 5 profissionais (adicional por extra)",
      "Relatórios",
      "Suporte prioritário",
    ],
  },
] as const;

export function PrecosPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Planos e preços
        </h1>
        <p className="text-muted-foreground">
          Escolha pelo tamanho da sua equipe. Valores e contratação chegam em
          breve — por enquanto, conheça o que cada plano oferece.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANOS.map((plano) => (
          <div
            key={plano.nome}
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {plano.publico}
              </p>
              <h2 className="font-display text-xl font-semibold">
                {plano.nome}
              </h2>
            </div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {plano.destaques.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CalendarCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TermosPage() {
  return (
    <PlaceholderPanel
      titulo="Termos e privacidade (LGPD)"
      descricao="Termos de uso e política de privacidade conforme a LGPD. Conteúdo em construção."
    />
  );
}
