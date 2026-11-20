"use client"

import { GalleryVerticalEnd, ShieldCheck, CheckCircle2 } from "lucide-react"
import { SignupWizardCard } from "@/components/shadcn/signup"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"

const CURRENT_YEAR = 2026

export function SignupPage() {
  return (
    <div className="relative grid min-h-svh bg-background lg:grid-cols-2">
      <div className="absolute right-4 top-4 z-10">
        <ModeToggle />
      </div>

      {/* Lado Esquerdo: Formulário de Cadastro em Wizard */}
      <div className="flex flex-col gap-4 p-6 md:p-10 justify-between">
        <div className="flex justify-center gap-2 md:justify-start">
          <a
            href="#/landing"
            className="flex items-center gap-2 font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs font-mono">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <span className="text-base font-extrabold tracking-tight">Atlas</span>
          </a>
        </div>

        <div className="flex flex-1 items-center justify-center py-4">
          <div className="w-full max-w-md">
            <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-md sm:p-8 dark:border-border/70 dark:shadow-none">
              {/* Rim light superior sutil */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
              />

              <SignupWizardCard
                onNavigateLogin={() => {
                  window.location.hash = "#/login"
                }}
                onSuccess={() => {
                  window.location.hash = "#/shadcn"
                }}
              />
            </div>
          </div>
        </div>

        {/* Rodapé discreto */}
        <div className="text-center md:text-left text-[11px] text-muted-foreground">
          © {CURRENT_YEAR} Atlas Workspace Technologies Ltda. Todos os direitos reservados.
        </div>
      </div>

      {/* Lado Direito: Capa Institucional e Prova Social */}
      <div className="relative hidden bg-muted lg:block overflow-hidden">
        <img
          src="/login-cover.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.25] dark:grayscale"
        />

        {/* Overlay com Depoimento e Métricas */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent flex flex-col justify-end p-12 space-y-6">
          {/* Card de Depoimento */}
          <div className="max-w-md rounded-2xl border border-border/80 bg-card/95 backdrop-blur-md p-6 shadow-xl space-y-3">
            <div className="flex items-center gap-1 text-amber-500 text-sm">
              {"★".repeat(5)}
            </div>
            <p className="text-xs sm:text-sm font-medium text-foreground leading-relaxed italic">
              &ldquo;O onboarding do Atlas nos permitiu configurar o workspace da equipe inteira em 5 minutos.
              Eliminamos planilhas e unificamos nossas rotinas diárias com máxima segurança.&rdquo;
            </p>
            <div className="pt-3 border-t border-border/60 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-foreground">Dra. Camila Torres</p>
                <p className="text-[11px] text-muted-foreground">Diretora de Operações • Hospital São Lucas</p>
              </div>
              <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                +40% agilidade
              </span>
            </div>
          </div>

          {/* Selos de Confiança e Conformidade */}
          <div className="max-w-md flex items-center justify-between text-xs text-muted-foreground pt-2">
            <div className="flex items-center gap-1.5 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>SOC-2 Type II Certified</span>
            </div>
            <div className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Conforme LGPD & GDPR</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
