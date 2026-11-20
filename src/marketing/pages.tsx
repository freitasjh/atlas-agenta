import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  FileSpreadsheet,
  Kanban,
  MessageCircle,
  QrCode,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { Button } from "@/components/shadcn/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/shadcn/ui/accordion";
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle";
import { SectionCards } from "@/components/shadcn/dashboard/section-cards";
import { Scheduler } from "@/components/shadcn/scheduler/scheduler";
import { INITIAL_PROFESSIONALS } from "@/components/shadcn/scheduler/scheduler-types";
import { KanbanBoard } from "@/components/shadcn/kanban/kanban-board";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { PlanCard } from "@/marketing/PlanCard";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/cn";
import {
  Hero,
  SocialProof,
  BentoGrid,
  BentoCard,
  Testimonials,
} from "@/components/marketing";

const NAV_LINKS = [
  { label: "Recursos", href: "#recursos" },
  { label: "Operações", href: "#operacoes" },
  { label: "Planos", href: "#planos" },
  { label: "Depoimentos", href: "#depoimentos" },
  { label: "FAQ", href: "#faq" },
] as const;

type ShowcaseTab = "kpi" | "scheduler" | "kanban";

const SHOWCASE_TABS = [
  { id: "kpi", label: "Métricas & Financeiro", icon: TrendingUp },
  { id: "scheduler", label: "Agenda da Equipe", icon: Calendar },
  { id: "kanban", label: "Quadro Kanban", icon: Kanban },
] as const;

/** Demo sem fotos remotas: o avatar cai no fallback (RNF01, sem request externo). */
const SHOWCASE_PROFESSIONALS = INITIAL_PROFESSIONALS.map((professional) => ({
  ...professional,
  avatar: "",
}));

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
 * Landing pública: layout do template `src/pages/LandingPage.tsx` com o
 * conteúdo Atlas Agenda. Navbar/footer são internos (a rota "/" não usa o
 * MarketingLayout, evitando cabeçalho duplicado).
 */
export function LandingPage() {
  const [activeTab, setActiveTab] = useState<ShowcaseTab>("kpi");
  const tabRefs = useRef<Partial<Record<ShowcaseTab, HTMLButtonElement | null>>>({});

  /** Roving tabindex (WAI-ARIA APG): setas/Home/End movem foco e seleção. */
  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    current: ShowcaseTab,
  ) {
    const index = SHOWCASE_TABS.findIndex((tab) => tab.id === current);
    if (index < 0) return;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % SHOWCASE_TABS.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + SHOWCASE_TABS.length) % SHOWCASE_TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = SHOWCASE_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = SHOWCASE_TABS[nextIndex];
    if (!next) return;
    setActiveTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
      {/* 1. Navbar sticky do template */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              aria-label="Atlas Agenda — início"
              className="flex items-center gap-2.5 rounded-md font-bold tracking-tight text-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-mono text-base font-bold text-primary-foreground shadow-xs">
                A
              </div>
              <span className="text-lg font-extrabold tracking-tight">
                Atlas Agenda
              </span>
            </Link>
            <span className="hidden rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline-flex">
              v2.0
            </span>
          </div>

          <nav
            aria-label="Navegação principal"
            className="hidden items-center gap-6 text-xs font-semibold text-muted-foreground md:flex"
          >
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <ModeToggle />
            <Button asChild variant="ghost" size="sm" className="text-xs font-semibold hover:bg-muted">
              <Link to="/login">Entrar</Link>
            </Button>
            <Button asChild size="sm" className="gap-1.5 text-xs font-semibold shadow-xs">
              <Link to="/cadastro">
                <span>Acessar Plataforma</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* 2. Hero com badge, CTAs, trust pills e showcase interativo */}
      <Hero
        chip={
          <>
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span className="font-semibold text-primary">Novidade:</span>
            <span>Agenda, WhatsApp e PIX unificados</span>
          </>
        }
        headline="Confirme cada horário e receba na hora, direto pelo WhatsApp."
        subheadline="O Atlas Agenda confirma seus agendamentos 24h antes, lembra o cliente e cobra por PIX assim que o atendimento termina. Menos faltas, menos corrida atrás de pagamento."
        primaryCta={{
          label: "Começar agora",
          to: "/cadastro",
          icon: <ArrowRight className="h-4 w-4" aria-hidden="true" />,
        }}
        secondaryCta={{ label: "Ver planos", to: "/precos", variant: "secondary" }}
        trustPills={[
          "14 dias grátis sem cartão",
          "Setup pronto em 2 minutos",
          "Em conformidade com a LGPD",
        ]}
      >
        <div
          id="operacoes"
          className="relative mx-auto mt-14 max-w-6xl rounded-2xl border border-border/80 bg-card p-2 shadow-[0_16px_48px_rgba(0,0,0,0.08)] sm:p-4"
          role="region"
          aria-label="Prévia do produto Atlas Agenda"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
          <div className="flex flex-col justify-between gap-3 border-b border-border/60 px-2 pb-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-500/80" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-amber-500/80" aria-hidden="true" />
              <span className="h-3 w-3 rounded-full bg-emerald-500/80" aria-hidden="true" />
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                atlas.agenda/app
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Áreas do produto"
              className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1"
            >
              {SHOWCASE_TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`showcase-tab-${id}`}
                  aria-selected={activeTab === id}
                  aria-controls={`showcase-panel-${id}`}
                  tabIndex={activeTab === id ? 0 : -1}
                  ref={(node) => {
                    tabRefs.current[id] = node;
                  }}
                  onClick={() => setActiveTab(id)}
                  onKeyDown={(event) => handleTabKeyDown(event, id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeTab === id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto text-left">
            {/* Painéis sempre montados: `hidden` preserva aria-controls e o
                estado interno de cada demo ao alternar de aba. */}
            <div
              role="tabpanel"
              id="showcase-panel-kpi"
              aria-labelledby="showcase-tab-kpi"
              hidden={activeTab !== "kpi"}
              className="space-y-4 p-2"
            >
              <SectionCards />
              <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-6 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  Todos os dados financeiros sincronizam em tempo real com os
                  atendimentos e a agenda da equipe.
                </p>
              </div>
            </div>

            <div
              role="tabpanel"
              id="showcase-panel-scheduler"
              aria-labelledby="showcase-tab-scheduler"
              hidden={activeTab !== "scheduler"}
              className="p-2"
            >
              <Scheduler initialProfessionals={SHOWCASE_PROFESSIONALS} />
            </div>

            <div
              role="tabpanel"
              id="showcase-panel-kanban"
              aria-labelledby="showcase-tab-kanban"
              hidden={activeTab !== "kanban"}
              className="p-2"
            >
              <KanbanBoard />
            </div>
          </div>
        </div>
      </Hero>

      {/* 3. Prova social */}
      <SocialProof
        eyebrow="Confiado por barbearias, clínicas e autônomos em todo o Brasil"
        logos={[
          "// BARBEARIAS",
          "• CLÍNICAS",
          "[+] ESTÉTICA",
          "~ AUTÔNOMOS",
          "> SALÕES",
        ]}
      />

      {/* 4. Bento grid de recursos */}
      <BentoGrid
        id="recursos"
        eyebrow="Ecossistema Unificado"
        headline="Tudo o que sua agenda precisa. Sem gambiarras."
        subheadline="Confirmar, lembrar e cobrar no mesmo fluxo. Uma experiência que sua equipe realmente terá prazer em usar."
      >
        <BentoCard
          colSpan={8}
          icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
          iconClassName="mb-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          title="Agenda sem conflito"
          description="Grade por profissional com prevenção de sobreposição. Cada horário fica reservado só uma vez, com lembrete da hora atual."
        >
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-2 text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                <span className="h-2 w-2 animate-ping rounded-full bg-emerald-500" aria-hidden="true" />
                Ao vivo
              </span>
              <span>3 profissionais • 0 conflitos</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-border/60 bg-background p-2.5 shadow-2xs">
                <p className="text-xs font-semibold text-foreground">Dra. Camila</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">5 consultas</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background p-2.5 shadow-2xs">
                <p className="text-xs font-semibold text-foreground">Dr. Lucas</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">4 consultas</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-background p-2.5 shadow-2xs">
                <p className="text-xs font-semibold text-foreground">Dra. Mariana</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">6 consultas</p>
              </div>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          colSpan={4}
          icon={<MessageCircle className="h-5 w-5" aria-hidden="true" />}
          iconClassName="mb-4 bg-sky-500/10 text-sky-600 dark:text-sky-400"
          title="Confirmação automática"
          description="Lembrete 24h antes pelo WhatsApp. O cliente confirma com um toque e o no-show cai."
        >
          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="rounded-lg border border-border/70 bg-background p-2.5 shadow-2xs">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-mono text-muted-foreground">MSG-24h</span>
                <span className="rounded bg-emerald-500/10 px-1 font-bold text-emerald-600 dark:text-emerald-400">
                  Enviada
                </span>
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-foreground">
                Confirma seu horário de amanhã?
              </p>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          colSpan={4}
          icon={<QrCode className="h-5 w-5" aria-hidden="true" />}
          iconClassName="mb-4 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          title="Cobrança por PIX"
          description="QR Code e copia e cola enviados após o atendimento, com baixa automática do pagamento."
        >
          <div className="flex items-center justify-between border-t border-border/50 pt-3 font-mono text-xs">
            <span className="text-muted-foreground">PIX recebido</span>
            <span className="font-bold text-foreground">R$ 120,00</span>
          </div>
        </BentoCard>

        <BentoCard
          colSpan={4}
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          iconClassName="mb-4 bg-violet-500/10 text-violet-600 dark:text-violet-400"
          title="Multi-profissional"
          description="Vários profissionais na mesma agenda, cada um com sua grade e horários."
        >
          <div className="flex items-center gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            <span>Sem conflito entre profissionais</span>
          </div>
        </BentoCard>

        <BentoCard
          colSpan={4}
          icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
          iconClassName="mb-4 bg-primary/10 text-primary"
          title="Relatórios e exportação"
          description="Acompanhe faturamento e exporte dados para Excel ou CSV quando precisar."
        >
          <div className="flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
            <span>Formatos:</span>
            <span className="font-mono">CSV • XLSX</span>
          </div>
        </BentoCard>
      </BentoGrid>

      {/* 5. Planos (conteúdo Atlas Agenda) com moldura da seção do template */}
      <section id="planos" className="space-y-6 border-t border-border/60 bg-muted/15 py-12 sm:py-20">
        <div className="mx-auto max-w-7xl space-y-2 px-4 sm:px-6 lg:px-8">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            Planos
          </span>
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Escolha o plano do tamanho da sua equipe
          </h2>
          <p className="text-muted-foreground">
            Valores mensais, sem fidelidade. Comece grátis e contrate ao criar a
            conta.
          </p>
        </div>
        <div className="mx-auto grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {PLANS.map((plano) => (
            <PlanCard key={plano.slug} plan={plano} variant="preview" />
          ))}
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Button asChild variant="outline">
            <Link to="/precos">Ver todos os planos</Link>
          </Button>
        </div>
      </section>

      {/* 6. Depoimentos */}
      <Testimonials
        id="depoimentos"
        eyebrow="Casos de sucesso"
        headline="Quem usa o Atlas Agenda não volta para planilhas."
        subheadline="Veja como nossos clientes reduziram faltas e organizaram a cobrança."
        items={[
          {
            quote:
              "A confirmação automática pelo WhatsApp derrubou as faltas na clínica. Hoje o PIX fecha o atendimento sem eu precisar cobrar na mão.",
            name: "Dra. Sofia Alencar",
            role: "Clínica • Alencar & Associados",
            initials: "SA",
            avatarClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          },
          {
            quote:
              "Encaixe rápido e lembrete que derruba o buraco na agenda. A barbearia parou de perder horário vazio.",
            name: "Carlos Lima",
            role: "Barbearia • Studio Lima",
            initials: "CL",
            avatarClassName: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
          },
          {
            quote: "Cobro por PIX assim que termino e recebo sem cobrar na mão. Simples e direto.",
            name: "Mariana Fontes",
            role: "Autônoma • Estética",
            initials: "MF",
            avatarClassName: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
          },
        ]}
      />

      {/* 7. FAQ com Accordion do template (Radix) */}
      <section id="faq" className="border-t border-border/60 bg-muted/10 py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Perguntas frequentes
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Ficou com alguma dúvida?
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Respostas claras para as dúvidas mais comuns.
            </p>
          </div>

          <Accordion
            type="single"
            collapsible
            className="w-full rounded-2xl border border-border/70 bg-card p-6 shadow-xs"
          >
            {FAQ_ITEMS.map((item) => (
              <AccordionItem key={item.pergunta} value={item.pergunta}>
                <AccordionTrigger>{item.pergunta}</AccordionTrigger>
                <AccordionContent>{item.resposta}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* 8. Banner CTA final */}
      <section className="relative overflow-hidden border-t border-border/60 bg-card py-20 text-center sm:py-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent" />
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Modernize sua operação hoje</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Pronto para transformar a produtividade da sua equipe?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Junte-se a quem já reduziu faltas e organizou a cobrança com o Atlas Agenda.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-11 gap-2 px-8 text-sm font-semibold shadow-md">
              <Link to="/cadastro">
                <span>Acessar Plataforma</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 9. Footer completo do template */}
      <footer className="border-t border-border/60 bg-muted/20 py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 border-b border-border/50 pb-10 sm:grid-cols-4">
            <div>
              <p className="mb-3 text-sm font-bold text-foreground">Produto</p>
              <ul className="space-y-2">
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Visão Geral</a></li>
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Agenda Multi-Profissional</a></li>
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Confirmação por WhatsApp</a></li>
                <li><Link to="/precos" className="transition-colors hover:text-foreground">Planos & Preços</Link></li>
              </ul>
            </div>
            <div id="solucoes">
              <p className="mb-3 text-sm font-bold text-foreground">Soluções</p>
              <ul className="space-y-2">
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Clínicas & Saúde</a></li>
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Barbearia & Estética</a></li>
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Autônomos</a></li>
                <li><a href="#recursos" className="transition-colors hover:text-foreground">Grandes Operações</a></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-sm font-bold text-foreground">Segurança</p>
              <ul className="space-y-2">
                <li>Conformidade LGPD</li>
                <li>PIX com baixa automática</li>
                <li>Trilha de auditoria</li>
                <li><Link to="/termos" className="transition-colors hover:text-foreground">Termos e privacidade</Link></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-sm font-bold text-foreground">Atlas Agenda</p>
              <p className="leading-relaxed text-muted-foreground">
                São Paulo, SP • Brasil
                <br />
                contato@atlasagenda.com.br
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="font-mono text-[10px]">Sistemas operacionais</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 pt-6 text-[11px] sm:flex-row">
            <p>© {new Date().getFullYear()} Atlas Agenda. Todos os direitos reservados.</p>
            <div className="flex items-center gap-4">
              <Link to="/app" className="transition-colors hover:text-foreground">Dashboard</Link>
              <Link to="/login" className="transition-colors hover:text-foreground">Login</Link>
              <Link to="/cadastro" className="transition-colors hover:text-foreground">Cadastrar</Link>
              <Link to="/termos" className="transition-colors hover:text-foreground">Termos</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
