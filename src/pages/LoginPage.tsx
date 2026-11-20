"use client"

import {
  CalendarDays,
  CheckCircle2,
  GalleryVerticalEnd,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { LoginForm } from "@/components/shadcn/auth/login-form"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"
import { loginSchema, type LoginInput } from "@/lib/validations/auth"

export function LoginPage() {
  // Template visual: a lógica real vive em `@/auth/LoginPage`. A instância RHF
  // existe aqui apenas para satisfazer o contrato controlado do `LoginForm`.
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  return (
    <div className="relative grid min-h-svh bg-background lg:grid-cols-2">
      <div className="absolute right-4 top-4 z-10">
        <ModeToggle />
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/login" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            Atlas
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.02)] sm:p-8 dark:border-border/60 dark:shadow-none">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
              />
              <LoginForm form={form} onSubmit={() => {}} />
            </div>
          </div>
        </div>
      </div>

      {/* Lado Direito: Capa em Background com Overlay Rico */}
      <aside
        aria-label="Apresentação do Atlas Agenda"
        className="relative hidden overflow-hidden bg-slate-950 text-slate-100 lg:block"
      >
        <img
          src="/auth-cover.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-slate-950/60 backdrop-blur-[1.5px]"
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-8 sm:p-10 xl:p-14">
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

          <div className="my-6 grid max-w-lg gap-3.5">
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
                  Disparos automáticos 24h e 2h antes. Reduz drasticamente
                  as faltas sem intervenção da recepção.
                </p>
              </div>
            </div>

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
                  Cobrança de sinal e recebimento direto na conta com conciliação
                  e baixa automática em tempo real.
                </p>
              </div>
            </div>

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
                  Controle de escalas por profissional e cálculo automático
                  de comissões por atendimento.
                </p>
              </div>
            </div>
          </div>

          <div className="max-w-lg space-y-3 border-t border-white/10 pt-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <div className="flex text-amber-400">{"★".repeat(5)}</div>
              <span className="font-semibold text-white">4.9/5</span>
              <span className="text-slate-400">— Escolha de mais de 1.200 clínicas e salões</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-emerald-400" />
                <span>Conforme LGPD &amp; Criptografia</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-primary" />
                <span>API Direta Banco Central</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
