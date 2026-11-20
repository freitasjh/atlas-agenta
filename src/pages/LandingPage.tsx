"use client"

import * as React from "react"
import {
  ArrowRight,
  Check,
  ShieldCheck,
  Calendar,
  Kanban,
  Lock,
  ChevronRight,
  Star,
  Zap,
  FileSpreadsheet,
} from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/shadcn/ui/accordion"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"
import { PricingTable } from "@/components/shadcn/pricing/pricing-table"
import { KanbanBoard } from "@/components/shadcn/kanban/kanban-board"
import { Scheduler } from "@/components/shadcn/scheduler/scheduler"
import { SectionCards } from "@/components/shadcn/dashboard/section-cards"
import { cn } from "@/lib/cn"

export function LandingPage() {
  const [activeInteractiveTab, setActiveInteractiveTab] = React.useState<
    "kpi" | "scheduler" | "kanban"
  >("kpi")

  const handleNavigate = (path: string) => {
    window.location.hash = path
  }

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
      {/* ============================================================ */}
      {/* 1. NAVBAR SUPERIOR                                           */}
      {/* ============================================================ */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo e Badge */}
          <div className="flex items-center gap-3">
            <a
              href="#/landing"
              className="flex items-center gap-2.5 font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs font-mono font-bold text-base">
                A
              </div>
              <span className="text-lg font-extrabold tracking-tight">Atlas</span>
            </a>
            <span className="hidden sm:inline-flex items-center rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              v2.0 Enterprise
            </span>
          </div>

          {/* Links de Navegação Desktop */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-muted-foreground">
            <a href="#recursos" className="transition-colors hover:text-foreground">
              Recursos
            </a>
            <a href="#solucoes" className="transition-colors hover:text-foreground">
              Operações
            </a>
            <a href="#precos" className="transition-colors hover:text-foreground">
              Planos & Preços
            </a>
            <a href="#depoimentos" className="transition-colors hover:text-foreground">
              Casos de Sucesso
            </a>
            <a href="#faq" className="transition-colors hover:text-foreground">
              FAQ
            </a>
          </nav>

          {/* Ações e Alternador de Tema */}
          <div className="flex items-center gap-2 sm:gap-3">
            <ModeToggle />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleNavigate("#/login")}
              className="text-xs font-semibold hover:bg-muted"
            >
              Entrar
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => handleNavigate("#/shadcn")}
              className="text-xs font-semibold shadow-xs gap-1.5"
            >
              <span>Acessar Plataforma</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* ============================================================ */}
      {/* 2. HERO SECTION                                              */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden pt-12 pb-20 sm:pt-16 sm:pb-28">
        {/* Glow de fundo sutil sem saturação escura */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[700px] rounded-full bg-primary/5 blur-3xl" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          {/* Micro-badge de anúncio */}
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/40 px-3.5 py-1 text-xs font-medium text-foreground shadow-2xs mb-6 hover:bg-muted/60 transition-colors cursor-pointer">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-primary">Novidade:</span>
            <span>Quadro Kanban e Agenda Multi-Profissional unificados</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>

          {/* Headline Imponente */}
          <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl leading-[1.15]">
            A infraestrutura operacional definitiva para equipes de alta performance.
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mt-6 max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
            Centralize atendimentos, agendamento de consultas médicas e técnicas, backlog de entregas com Kanban e gestão financeira em uma única experiência veloz e intuitiva.
          </p>

          {/* Botões de Ação */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              size="lg"
              onClick={() => handleNavigate("#/signup")}
              className="h-11 px-6 text-sm font-semibold shadow-md gap-2"
            >
              <span>Experimentar Gratuitamente</span>
              <ArrowRight className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => handleNavigate("#/login")}
              className="h-11 px-6 text-sm font-semibold border-border/80 hover:bg-muted/50"
            >
              Fazer Login no Workspace
            </Button>
          </div>

          {/* Micro Trust Pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
              14 dias grátis sem cartão
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
              Setup pronto em 2 minutos
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-500 stroke-[2.5]" />
              Em conformidade com LGPD & Bacen
            </span>
          </div>

          {/* ============================================================ */}
          {/* SHOWCASE INTERATIVO AO VIVO NO HERO                          */}
          {/* ============================================================ */}
          <div className="mt-14 relative mx-auto max-w-6xl rounded-2xl border border-border/80 bg-card p-2 sm:p-4 shadow-[0_16px_48px_rgba(0,0,0,0.08)]">
            {/* Rim light superior */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent rounded-t-2xl" />

            {/* Abas de Navegação do Mockup do Produto */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3 px-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  atlas.workspace/app
                </span>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1">
                <button
                  type="button"
                  onClick={() => setActiveInteractiveTab("kpi")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                    activeInteractiveTab === "kpi"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <TrendingUpIcon className="h-3.5 w-3.5" />
                  <span>Métricas & Financeiro</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveInteractiveTab("scheduler")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                    activeInteractiveTab === "scheduler"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Agenda da Equipe</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveInteractiveTab("kanban")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                    activeInteractiveTab === "kanban"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Kanban className="h-3.5 w-3.5" />
                  <span>Quadro Kanban</span>
                </button>
              </div>
            </div>

            {/* Conteúdo Dinâmico Renderizado ao Vivo no Mockup */}
            <div className="mt-4 text-left overflow-x-auto">
              {activeInteractiveTab === "kpi" && (
                <div className="p-2 space-y-4">
                  <SectionCards />
                  <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-6 text-center">
                    <p className="text-xs font-medium text-muted-foreground">
                      💡 Todos os dados financeiros sincronizam em tempo real com as consultas realizadas e o backlog do time.
                    </p>
                  </div>
                </div>
              )}

              {activeInteractiveTab === "scheduler" && (
                <div className="p-2">
                  <Scheduler />
                </div>
              )}

              {activeInteractiveTab === "kanban" && (
                <div className="p-2">
                  <KanbanBoard />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 3. LOGOS DE CONFIANÇA (SOCIAL PROOF)                         */}
      {/* ============================================================ */}
      <section className="border-y border-border/60 bg-muted/20 py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Confiado por mais de 1.200 clínicas, fintechs e consultorias modernas
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-8 sm:gap-14 opacity-70 grayscale transition-all hover:opacity-100 hover:grayscale-0">
            <span className="font-mono text-base font-bold tracking-tight text-foreground">
              // STONE
            </span>
            <span className="font-mono text-base font-bold tracking-tight text-foreground">
              • NUBANK ENTERPRISE
            </span>
            <span className="font-mono text-base font-bold tracking-tight text-foreground">
              [+] EINSTEIN SAÚDE
            </span>
            <span className="font-mono text-base font-bold tracking-tight text-foreground">
              ~ DASA MEDICINA
            </span>
            <span className="font-mono text-base font-bold tracking-tight text-foreground">
              &gt; VTEX LOGISTICS
            </span>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 4. BENTO GRID DE RECURSOS (DIRETIVA DESIGN.MD)               */}
      {/* ============================================================ */}
      <section id="recursos" className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Ecossistema Unificado
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Tudo o que sua operação precisa. Sem gambiarras.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
              Desenvolvido com foco em velocidade, ergonomia e precisão matemática. Uma experiência que sua equipe realmente terá prazer em usar.
            </p>
          </div>

          {/* Bento Grid Editorial Assimétrico */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Card 1: 8 Colunas (Destaque - Agenda Multi-Recurso) */}
            <div className="relative md:col-span-8 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4">
                  <Calendar className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground">
                  Grade de Agendamento Multi-Profissional
                </h3>
                <p className="mt-2 text-xs text-muted-foreground sm:text-sm leading-relaxed max-w-xl">
                  Coordene múltiplos especialistas lado a lado. Com régua horária contínua, indicador da hora atual em tempo real (*now indicator*), hachura de horários de almoço e bloqueios rápidos de agenda.
                </p>
              </div>

              {/* Prévia visual técnica */}
              <div className="mt-6 rounded-xl border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between text-xs font-mono text-muted-foreground pb-2 border-b border-border/50">
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    Ao Vivo: 10:45
                  </span>
                  <span>4 médicos na escala • 0 conflitos</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-background p-2.5 border border-border/60 shadow-2xs">
                    <p className="font-semibold text-foreground text-xs">Dra. Camila Torres</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Cardiologia (5 consultas)</p>
                  </div>
                  <div className="rounded-lg bg-background p-2.5 border border-border/60 shadow-2xs">
                    <p className="font-semibold text-foreground text-xs">Dr. Lucas Meireles</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Dermatologia (4 consultas)</p>
                  </div>
                  <div className="rounded-lg bg-background p-2.5 border border-border/60 shadow-2xs">
                    <p className="font-semibold text-foreground text-xs">Dra. Mariana Dias</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Ortopedia (6 consultas)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: 4 Colunas (Quadro Kanban Linear) */}
            <div className="relative md:col-span-4 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 mb-4">
                  <Kanban className="h-5 w-5" />
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground">
                  Kanban no Padrão Linear
                </h3>
                <p className="mt-2 text-xs text-muted-foreground sm:text-sm leading-relaxed">
                  Arraste cards fluidamente com `@dnd-kit`, controle de sub-tarefas, prioridades com tags semânticas e busca instantânea.
                </p>
              </div>

              <div className="mt-6 rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
                <div className="rounded-lg bg-background p-2.5 border border-border/70 shadow-2xs">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-mono text-muted-foreground">OPS-101</span>
                    <span className="rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 px-1 font-bold">Urgente</span>
                  </div>
                  <p className="text-xs font-semibold text-foreground mt-1 truncate">
                    Conciliação Bacen Lote #894
                  </p>
                </div>
              </div>
            </div>

            {/* Card 3: 4 Colunas (Conciliação e Finanças) */}
            <div className="relative md:col-span-4 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-4">
                  <Zap className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-foreground">
                  Faturamento & Liquidação
                </h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Cálculo automático de honorários, controle de recebíveis em aberto e taxas por profissional.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between font-mono text-xs">
                <span className="text-muted-foreground">Faturamento Previsto:</span>
                <span className="font-bold text-foreground">R$ 5.800,00</span>
              </div>
            </div>

            {/* Card 4: 4 Colunas (Segurança & Auditoria) */}
            <div className="relative md:col-span-4 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 mb-4">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-foreground">
                  Conformidade & RBAC
                </h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Permissões granulares por função, logs de acesso imutáveis e sigilo rigoroso de prontuários.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>Auditoria e trilhas completas</span>
              </div>
            </div>

            {/* Card 5: 4 Colunas (Exportação e Integrações) */}
            <div className="relative md:col-span-4 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold tracking-tight text-foreground">
                  Relatórios & Webhooks
                </h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Exporte para Excel ou sincronize com ERPs, contabilidades e ferramentas de BI via API.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>Formatos:</span>
                <span>CSV • XLSX • JSON • REST</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 5. TABELA DE PREÇOS (PRICING TABLE) INTEGRADA                 */}
      {/* ============================================================ */}
      <section id="precos" className="border-t border-border/60 bg-muted/15 py-12">
        <PricingTable onSelectPlan={(_plan, _billing) => handleNavigate("#/signup")} />
      </section>

      {/* ============================================================ */}
      {/* 6. DEPOIMENTOS DE CLIENTES (SOCIAL PROOF)                    */}
      {/* ============================================================ */}
      <section id="depoimentos" className="py-20 sm:py-28 border-t border-border/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Casos de Sucesso
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Quem usa o Atlas não volta para planilhas.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Veja como nossos clientes reduziram tempos operacionais e aumentaram faturamento.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Depoimento 1 */}
            <div className="relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex items-center gap-1 text-amber-500 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-500" />
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed italic">
                  &ldquo;A transição da grade de papel para o Atlas eliminou 100% dos conflitos de sala e horário entre nossos 14 médicos. O faturamento cresceu 32% em 3 meses.&rdquo;
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-border/50 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold flex items-center justify-center text-xs">
                  SA
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Dra. Sofia Alencar</p>
                  <p className="text-[11px] text-muted-foreground">Diretora Clínica • Alencar & Associados</p>
                </div>
              </div>
            </div>

            {/* Depoimento 2 */}
            <div className="relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex items-center gap-1 text-amber-500 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-500" />
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed italic">
                  &ldquo;O Kanban com padrão Linear e a conciliação automática com bancos nos economizaram cerca de 25 horas semanais de digitação manual de relatórios.&rdquo;
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-border/50 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 font-bold flex items-center justify-center text-xs">
                  CL
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Carlos Eduardo Lima</p>
                  <p className="text-[11px] text-muted-foreground">CFO • FinScale Investimentos</p>
                </div>
              </div>
            </div>

            {/* Depoimento 3 */}
            <div className="relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent rounded-t-2xl" />
              <div>
                <div className="flex items-center gap-1 text-amber-500 mb-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-500" />
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed italic">
                  &ldquo;Visual limpo, sem firulas inúteis e com desempenho instantâneo. A recepção e a equipe médica adotaram no primeiro dia sem precisar de treinamento longo.&rdquo;
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-border/50 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 font-bold flex items-center justify-center text-xs">
                  MF
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Mariana Fontes</p>
                  <p className="text-[11px] text-muted-foreground">Head de Operações • Grupo Vitta</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 7. PERGUNTAS FREQUENTES (FAQ COM ACCORDION)                  */}
      {/* ============================================================ */}
      <section id="faq" className="py-20 sm:py-28 border-t border-border/60 bg-muted/10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Perguntas Frequentes
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              Ficou com alguma dúvida?
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Respostas claras para as dúvidas mais comuns sobre migração, contratação e recursos.
            </p>
          </div>

          <Accordion type="single" collapsible className="w-full rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
            <AccordionItem value="item-1">
              <AccordionTrigger>Como funciona o teste grátis de 14 dias?</AccordionTrigger>
              <AccordionContent>
                Você tem acesso irrestrito a todos os recursos do plano Professional durante 14 dias. Não exigimos cartão de crédito para iniciar e você pode convidar toda a sua equipe para testar na prática.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger>Consigo migrar meus agendamentos e cadastros atuais?</AccordionTrigger>
              <AccordionContent>
                Sim! Oferecemos importador automático via planilha Excel/CSV para pacientes, clientes, catálogo de serviços e histórico anterior. Além disso, nosso suporte pode auxiliar no mapeamento dos campos.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger>A plataforma cumpre as normas da LGPD e sigilo profissional?</AccordionTrigger>
              <AccordionContent>
                Totalmente. Utilizamos criptografia TLS 1.3 em trânsito e AES-256 em repouso. Apenas profissionais autorizados têm acesso a prontuários e dados sensíveis de pacientes, com trilha de auditoria completa de quem visualizou ou alterou cada registro.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger>Posso alterar de plano ou cancelar a qualquer momento?</AccordionTrigger>
              <AccordionContent>
                Sim. Não há contratos de fidelidade ou multas de cancelamento nos planos mensais. Caso queira fazer upgrade para acomodar mais profissionais, a diferença é calculada proporcionalmente em segundos.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5">
              <AccordionTrigger>Como funciona o suporte técnico?</AccordionTrigger>
              <AccordionContent>
                Clientes dos planos Starter contam com atendimento via e-mail em até 48h úteis. No plano Professional, o atendimento é prioritário via chat em tempo real dentro do sistema. No Enterprise, disponibilizamos gerente de contas dedicado com SLA de resposta de até 30 minutos.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 8. BANNER CTA FINAL                                          */}
      {/* ============================================================ */}
      <section className="relative overflow-hidden py-20 sm:py-24 border-t border-border/60 bg-card text-center">
        {/* Rim light superior */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent" />

        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-4">
            <Zap className="h-3.5 w-3.5" />
            <span>Modernize sua operação hoje</span>
          </div>

          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Pronto para transformar a produtividade da sua equipe?
          </h2>

          <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Junte-se a mais de 1.200 operações que já reduziram custos e elevaram a satisfação de seus clientes e pacientes.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              size="lg"
              onClick={() => handleNavigate("#/shadcn")}
              className="h-11 px-8 text-sm font-semibold shadow-md gap-2"
            >
              <span>Acessar Plataforma Atlas</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ============================================================ */}
      {/* 9. FOOTER COMPLETO                                           */}
      {/* ============================================================ */}
      <footer className="border-t border-border/60 bg-muted/20 py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 pb-10 border-b border-border/50">
            {/* Coluna 1 */}
            <div>
              <p className="font-bold text-foreground text-sm mb-3">Produto</p>
              <ul className="space-y-2">
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Visão Geral</a></li>
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Grade Multi-Profissional</a></li>
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Quadro Kanban</a></li>
                <li><a href="#precos" className="hover:text-foreground transition-colors">Planos & Preços</a></li>
              </ul>
            </div>

            {/* Coluna 2 */}
            <div>
              <p className="font-bold text-foreground text-sm mb-3">Soluções</p>
              <ul className="space-y-2">
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Clínicas & Saúde</a></li>
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Consultorias & Serviços</a></li>
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Fintechs & Pagamentos</a></li>
                <li><a href="#recursos" className="hover:text-foreground transition-colors">Grandes Operações</a></li>
              </ul>
            </div>

            {/* Coluna 3 */}
            <div>
              <p className="font-bold text-foreground text-sm mb-3">Segurança</p>
              <ul className="space-y-2">
                <li><span className="hover:text-foreground transition-colors">Conformidade LGPD</span></li>
                <li><span className="hover:text-foreground transition-colors">Certificação SOC2</span></li>
                <li><span className="hover:text-foreground transition-colors">Status dos Servidores (99.9%)</span></li>
                <li><span className="hover:text-foreground transition-colors">Trilha de Auditoria</span></li>
              </ul>
            </div>

            {/* Coluna 4 */}
            <div>
              <p className="font-bold text-foreground text-sm mb-3">Atlas Workspace</p>
              <p className="text-muted-foreground leading-relaxed">
                São Paulo, SP • Brasil
                <br />
                contato@atlas.com.br
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-mono text-[10px]">Sistemas operacionais</span>
              </div>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px]">
            <p>© {new Date().getFullYear()} Atlas Plataforma Financeira & Operacional Ltda. Todos os direitos reservados.</p>
            <div className="flex items-center gap-4">
              <a href="#/shadcn" className="hover:text-foreground transition-colors">Dashboard</a>
              <a href="#/login" className="hover:text-foreground transition-colors">Login</a>
              <a href="#/signup" className="hover:text-foreground transition-colors">Cadastrar</a>
              <a href="#/claude" className="hover:text-foreground transition-colors">Perfil Claude</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function TrendingUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}
