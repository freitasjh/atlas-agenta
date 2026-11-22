import {
  CalendarDays,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import { Link, Outlet } from "react-router-dom"

import { cn } from "@/lib/cn"
import { Logo } from "@/components/Logo"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"

interface AuthShellProps {
  /** Largura do conteúdo central. Padrão: `max-w-md` (mesmo recorte do card). */
  contentClassName?: string
  /**
   * Casca bloqueada de áreas isoladas (ex.: `/internal-admin`): só a marca +
   * `<Outlet />` no mesmo recorte `max-w-md`. Sem link público, sem seletor de
   * tema e sem a coluna de marketing — nenhuma saída para o fluxo público.
   */
  internal?: boolean
}

/**
 * Shell único das rotas de autenticação (login, cadastro, recuperação,
 * redefinição e troca de senha).
 *
 * Visual (default):
 * - Coluna Esquerda: Marca Atlas + Formulário centralizado + ModeToggle.
 * - Coluna Direita (Desktop): Imagem em background absoluto com overlay
 *   glassmorphic, proposta de valor em camadas, micro-cards de benefícios
 *   (Anti-No-Show, PIX, Multi-Profissional) e selos de conformidade/segurança.
 *
 * Visual (`internal`): coluna única, marca sem link e `<Outlet />` — a casca
 * exigida para o fluxo `mfa_pending` (SPEC internal-operators-mfa §3).
 */
export function AuthShell({
  contentClassName = "max-w-md",
  internal = false,
}: AuthShellProps) {
  return (
    <div
      className={cn(
        "relative grid min-h-svh bg-background text-foreground",
        !internal && "lg:grid-cols-2",
      )}
    >
      {internal ? null : (
        <div className="absolute right-4 top-4 z-10">
          <ModeToggle />
        </div>
      )}

      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          {internal ? (
            <Logo />
          ) : (
            <Link
              to="/"
              aria-label="Atlas Agenda — início"
              className="flex w-fit items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Logo />
            </Link>
          )}
        </div>

        {/* `<div>`, não `<main>`: `RootLayout` já isola o conteúdo num `<main>`. */}
        <div className="flex flex-1 items-center justify-center">
          <div className={cn("w-full", contentClassName)}>
            <Outlet />
          </div>
        </div>
      </div>

      {internal ? null : (
        <aside
          aria-label="Apresentação do Atlas Agenda"
          className="relative hidden overflow-hidden bg-slate-950 text-slate-100 lg:block"
        >
          {/* Imagem de Fundo (Cover em tela inteira na coluna lateral) */}
          <img
            src="/auth-cover.jpg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
            loading="eager"
          />

          {/* Gradiente Scrim + Backdrop Blur para legibilidade cristalina */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-slate-950/60 backdrop-blur-[1.5px]"
          />

          {/* Brilho radial sutil em tom esmeralda */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-emerald-500/10 blur-3xl"
          />

          {/* Conteúdo Rico e Estruturado sobre o Background */}
          <div className="relative z-10 flex h-full flex-col justify-between p-8 sm:p-10 xl:p-14">
            {/* Topo: Kicker & Headline de Impacto */}
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-300 backdrop-blur-md">
                <Sparkles className="size-3.5 text-emerald-400" />
                <span>Plataforma Integrada de Gestão &amp; PIX</span>
              </div>

              <h2 className="font-display text-3xl font-bold tracking-tight text-white xl:text-4xl">
                Agenda e cobrança no piloto automático, sem no-show.
              </h2>

              <p className="max-w-lg text-sm leading-relaxed text-slate-300">
                Lembretes automáticos no WhatsApp, confirmação em 1 clique e
                recebimento direto por PIX instantâneo — sem taxas abusivas e sem
                perder tempo com cobrança manual.
              </p>
            </div>

            {/* Centro: Cards Glassmorphism com Métricas e Diferenciais Reais */}
            <div className="my-6 grid max-w-lg gap-3.5">
              {/* Card 1: Anti-no-show WhatsApp */}
              <div className="flex items-start gap-3.5 rounded-xl border border-white/10 bg-slate-900/60 p-3.5 shadow-lg backdrop-blur-md">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                  <MessageCircle className="size-5" />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Confirmação Ativa via WhatsApp
                    </h3>
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                      -85% faltas
                    </span>
                  </div>
                  <p className="text-xs leading-normal text-slate-300">
                    Disparos automáticos 24h e 2h antes. Seu cliente confirma ou
                    solicita reagendamento direto na mensagem.
                  </p>
                </div>
              </div>

              {/* Card 2: PIX Instantâneo */}
              <div className="flex items-start gap-3.5 rounded-xl border border-white/10 bg-slate-900/60 p-3.5 shadow-lg backdrop-blur-md">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <Zap className="size-5" />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Cobrança &amp; PIX Instantâneo
                    </h3>
                    <span className="rounded-full border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                      Baixa imediata
                    </span>
                  </div>
                  <p className="text-xs leading-normal text-slate-300">
                    Exija sinal de garantia na reserva ou cobre ao finalizar o
                    serviço. Dinheiro cai na hora direto na sua conta.
                  </p>
                </div>
              </div>

              {/* Card 3: Multi-Profissional & Escalas */}
              <div className="flex items-start gap-3.5 rounded-xl border border-white/10 bg-slate-900/60 p-3.5 shadow-lg backdrop-blur-md">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400">
                  <CalendarDays className="size-5" />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      Gestão da Equipe &amp; Comissões
                    </h3>
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                      Sem conflitos
                    </span>
                  </div>
                  <p className="text-xs leading-normal text-slate-300">
                    Escalas por profissional, bloqueio de conflitos de horários e
                    comissões calculadas automaticamente.
                  </p>
                </div>
              </div>
            </div>

            {/* Rodapé: Prova Social & Selos de Confiança */}
            <div className="max-w-lg space-y-3 border-t border-white/10 pt-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <div className="flex text-amber-400">
                  {"★".repeat(5)}
                </div>
                <span className="font-semibold text-white">4.9/5</span>
                <span className="text-slate-400">— Escolha de mais de 1.200 clínicas e salões</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-emerald-400" />
                  <span>Conforme LGPD &amp; Criptografia Ponta a Ponta</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>API Direta Banco Central</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
