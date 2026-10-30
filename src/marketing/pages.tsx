import { Link } from "react-router-dom";
import {
  CalendarCheck,
  MessageCircle,
  QrCode,
  Scissors,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { BrandIllustration } from "@/marketing/BrandIllustration";
import { PlanCard } from "@/marketing/PlanCard";
import { PLANS } from "@/lib/plans";

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
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarCheck
              className="h-3.5 w-3.5 text-primary"
              aria-hidden="true"
            />
            Agenda + cobrança num só lugar
          </span>

          <h1 className="max-w-3xl font-display text-[clamp(1.75rem,5vw,2.75rem)] font-semibold leading-tight tracking-tight">
            Confirme cada horário e receba na hora, direto pelo WhatsApp.
          </h1>

          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
            O Atlas Agenda confirma seus agendamentos 24h antes, lembra o
            cliente e cobra por PIX assim que o atendimento termina. Menos
            faltas, menos corrida atrás de pagamento.
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
        </div>

        <BrandIllustration variant="hero" className="w-full" />
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

      <section aria-labelledby="para-quem" className="space-y-6">
        <h2
          id="para-quem"
          className="font-display text-2xl font-semibold tracking-tight"
        >
          Feito para o seu dia a dia
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature
            icon={<Scissors className="h-5 w-5" aria-hidden="true" />}
            titulo="Barbearias e estúdios"
            descricao="Encaixe rápido e lembrete que derruba o buraco na agenda."
          />
          <Feature
            icon={<Stethoscope className="h-5 w-5" aria-hidden="true" />}
            titulo="Clínicas e consultórios"
            descricao="Confirmação 24h antes e menos faltas sem ligar para ninguém."
          />
          <Feature
            icon={<UserRound className="h-5 w-5" aria-hidden="true" />}
            titulo="Autônomos"
            descricao="Cobre por PIX assim que termina e receba sem cobrar na mão."
          />
        </div>
      </section>

      <section aria-labelledby="previa-planos" className="space-y-6">
        <div className="flex flex-col gap-2">
          <h2
            id="previa-planos"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            Escolha o plano do tamanho da sua equipe
          </h2>
          <p className="text-muted-foreground">
            Valores mensais, sem fidelidade. Comece grátis e contrate ao criar a
            conta.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {PLANS.map((plano) => (
            <PlanCard key={plano.slug} plan={plano} variant="preview" />
          ))}
        </div>
        <div>
          <Button asChild variant="outline">
            <Link to="/precos">Ver todos os planos</Link>
          </Button>
        </div>
      </section>

      <Faq />
    </div>
  );
}

const FAQ_ITEMS: ReadonlyArray<{ pergunta: string; resposta: string }> = [
  {
    pergunta: "Preciso instalar algo?",
    resposta:
      "Não. O Atlas Agenda roda no navegador do celular e do computador.",
  },
  {
    pergunta: "Como funciona o WhatsApp?",
    resposta:
      "Você conecta o número da empresa uma vez e as mensagens de confirmação e cobrança saem automaticamente.",
  },
  {
    pergunta: "Como o cliente paga?",
    resposta:
      "Ao fim do atendimento, enviamos um PIX com QR Code e copia e cola. A baixa é automática quando o pagamento cai.",
  },
  {
    pergunta: "Posso trocar de plano depois?",
    resposta:
      "Pode. Comece pelo plano que couber hoje e ajuste conforme a equipe cresce.",
  },
];

/**
 * FAQ curto (RF11). Usa `<details>/<summary>` nativo — expansível por teclado
 * sem dependência nova (decisão travada: nada de Radix Accordion). Cada item é
 * um grupo colapsável com foco visível no `summary`.
 */
function Faq() {
  return (
    <section aria-labelledby="faq" className="space-y-6">
      <h2
        id="faq"
        className="font-display text-2xl font-semibold tracking-tight"
      >
        Perguntas frequentes
      </h2>
      <div className="flex flex-col gap-3">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.pergunta}
            className="group rounded-lg border border-border bg-card"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-5 py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
              <span>{item.pergunta}</span>
              <CalendarCheck
                className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            <p className="px-5 pb-4 text-sm text-muted-foreground">
              {item.resposta}
            </p>
          </details>
        ))}
      </div>
    </section>
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

/**
 * `/precos` (ADR-05): consome `PlanCard variant="full"` — fonte única de markup
 * do card (ADR-03), que formata o preço com `formatPlanPrice` a partir de
 * `PLANS` (ADR-01). Nenhuma lista de planos duplicada nem valor colado fora de
 * `src/lib/plans.ts`. Sem checkout/billing: a contratação acontece ao criar a
 * conta (RF07).
 */
export function PrecosPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Planos e preços
        </h1>
        <p className="text-muted-foreground">
          Escolha pelo tamanho da sua equipe. Comece grátis e só contrate quando
          criar a conta.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plano) => (
          <PlanCard key={plano.slug} plan={plano} variant="full" />
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        A contratação acontece ao criar a conta. Nenhum cartão é pedido agora.
      </p>
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
