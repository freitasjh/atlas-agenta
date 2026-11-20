import { useState } from "react"
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, ShieldCheck, Zap } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import { Switch } from "@/components/shadcn/ui/switch"
import { cn } from "@/lib/cn"
import { SectionHeading, SettingRow, SettingsCard } from "./settings-primitives"
import {
  MODULE_LABELS,
  NOTIFICATION_EVENTS,
  ROLE_LABELS,
  WEBHOOK_EVENT_LABELS,
  type ModuleId,
  type PermissionLevel,
  type RoleId,
  type SettingsValues,
} from "./settings-types"

export interface SectionProps {
  values: SettingsValues
  onChange: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void
}

function SelectField({
  id,
  value,
  onValueChange,
  options,
}: {
  id?: string
  value: string
  onValueChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="h-9 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TextField({
  id,
  value,
  onChange,
  mono,
  placeholder,
  type,
  suffix,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  placeholder?: string
  type?: string
  suffix?: string
}) {
  return (
    <div className="relative w-full">
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-9 w-full text-xs", mono && "font-mono tabular-nums", suffix && "pr-10")}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}

function ToggleField({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-2.5 sm:justify-end">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      <span className="text-[11px] font-medium text-muted-foreground sm:hidden">
        {checked ? "Ativado" : "Desativado"}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function GeneralSection({ values, onChange }: SectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Geral" description="Identidade da empresa e formatos regionais usados em todo o sistema." />
      <SettingsCard title="Dados da empresa" description="Aparecem em notas, faturas e comprovantes.">
        <SettingRow label="Razão social" htmlFor="companyName">
          <TextField id="companyName" value={values.companyName} onChange={(v) => onChange("companyName", v)} />
        </SettingRow>
        <SettingRow label="Nome fantasia" hint="Exibido na sidebar e nos e-mails." htmlFor="tradeName">
          <TextField id="tradeName" value={values.tradeName} onChange={(v) => onChange("tradeName", v)} />
        </SettingRow>
        <SettingRow label="CNPJ" htmlFor="cnpj">
          <TextField id="cnpj" mono value={values.cnpj} onChange={(v) => onChange("cnpj", v)} />
        </SettingRow>
        <SettingRow label="E-mail financeiro" htmlFor="email">
          <TextField id="email" type="email" value={values.email} onChange={(v) => onChange("email", v)} />
        </SettingRow>
        <SettingRow label="Telefone" htmlFor="phone">
          <TextField id="phone" mono value={values.phone} onChange={(v) => onChange("phone", v)} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Região e formatos" description="Afetam datas, moedas e relatórios.">
        <SettingRow label="Fuso horário" htmlFor="timezone">
          <SelectField id="timezone" value={values.timezone} onValueChange={(v) => onChange("timezone", v)} options={[
            { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
            { value: "America/Manaus", label: "Manaus (GMT-4)" },
            { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
          ]} />
        </SettingRow>
        <SettingRow label="Idioma" htmlFor="locale">
          <SelectField id="locale" value={values.locale} onValueChange={(v) => onChange("locale", v)} options={[
            { value: "pt-BR", label: "Português (Brasil)" },
            { value: "en-US", label: "English (US)" },
            { value: "es-ES", label: "Español" },
          ]} />
        </SettingRow>
        <SettingRow label="Moeda padrão" htmlFor="currency">
          <SelectField id="currency" value={values.currency} onValueChange={(v) => onChange("currency", v)} options={[
            { value: "BRL", label: "Real (R$)" },
            { value: "USD", label: "Dólar (US$)" },
            { value: "EUR", label: "Euro (€)" },
          ]} />
        </SettingRow>
        <SettingRow label="Formato de data" htmlFor="dateFormat">
          <SelectField id="dateFormat" value={values.dateFormat} onValueChange={(v) => onChange("dateFormat", v)} options={[
            { value: "dd/MM/yyyy", label: "31/12/2026" },
            { value: "yyyy-MM-dd", label: "2026-12-31" },
            { value: "MM/dd/yyyy", label: "12/31/2026" },
          ]} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function AppearanceSection({ values, onChange }: SectionProps) {
  const themes: { value: SettingsValues["theme"]; label: string; swatch: string }[] = [
    { value: "system", label: "Sistema", swatch: "bg-gradient-to-r from-background to-foreground/80" },
    { value: "light", label: "Claro", swatch: "bg-background" },
    { value: "dark", label: "Escuro", swatch: "bg-foreground" },
  ]
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Aparência" description="Personalize como a interface é exibida para você." />
      <SettingsCard title="Tema" description="Segue o modo claro/escuro do sistema por padrão.">
        <div className="grid grid-cols-3 gap-3 p-4 sm:px-5">
          {themes.map((t) => {
            const active = values.theme === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange("theme", t.value)}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition-all",
                  active
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "border-border/80 bg-card text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <span className={cn("h-8 w-full rounded-md border border-border/70", t.swatch)} />
                {t.label}
              </button>
            )
          })}
        </div>
      </SettingsCard>
      <SettingsCard title="Preferências">
        <SettingRow label="Densidade das tabelas" hint="Compacto exibe mais linhas por tela." htmlFor="density">
          <SelectField id="density" value={values.density} onValueChange={(v) => onChange("density", v as SettingsValues["density"])} options={[
            { value: "comfortable", label: "Confortável" },
            { value: "compact", label: "Compacto" },
          ]} />
        </SettingRow>
        <SettingRow label="Reduzir animações" hint="Respeita prefers-reduced-motion." htmlFor="reduceMotion">
          <ToggleField id="reduceMotion" label="Reduzir animações" checked={values.reduceMotion} onCheckedChange={(v) => onChange("reduceMotion", v)} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function FinancialSection({ values, onChange }: SectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Financeiro & Fiscal" description="Regras que impactam lançamentos, cobranças e fechamento contábil." />
      <SettingsCard title="Fiscal">
        <SettingRow label="Regime tributário" htmlFor="taxRegime">
          <SelectField id="taxRegime" value={values.taxRegime} onValueChange={(v) => onChange("taxRegime", v)} options={[
            { value: "mei", label: "MEI" },
            { value: "simples", label: "Simples Nacional" },
            { value: "presumido", label: "Lucro Presumido" },
            { value: "real", label: "Lucro Real" },
          ]} />
        </SettingRow>
        <SettingRow label="Início do ano fiscal" htmlFor="fiscalYearStart">
          <SelectField id="fiscalYearStart" value={values.fiscalYearStart} onValueChange={(v) => onChange("fiscalYearStart", v)} options={
            ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map((m, i) => ({
              value: m,
              label: new Date(2026, i, 1).toLocaleDateString("pt-BR", { month: "long" }),
            }))
          } />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Cobrança e encargos">
        <SettingRow label="Multa por atraso" htmlFor="lateFee">
          <TextField id="lateFee" mono suffix="%" value={values.lateFeePercent} onChange={(v) => onChange("lateFeePercent", v)} />
        </SettingRow>
        <SettingRow label="Juros ao mês" htmlFor="interest">
          <TextField id="interest" mono suffix="%" value={values.interestPercentMonth} onChange={(v) => onChange("interestPercentMonth", v)} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Conciliação e fechamento">
        <SettingRow label="Conciliação automática" hint="Casa lançamentos do extrato com valor e data idênticos." htmlFor="autoReconcile">
          <ToggleField id="autoReconcile" label="Conciliação automática" checked={values.autoReconcile} onCheckedChange={(v) => onChange("autoReconcile", v)} />
        </SettingRow>
        <SettingRow label="Dia de fechamento mensal" hint="Após esta data, o mês anterior é encerrado." htmlFor="closingDay">
          <TextField id="closingDay" mono suffix="dia" value={values.closingDay} onChange={(v) => onChange("closingDay", v)} />
        </SettingRow>
        <SettingRow label="Bloquear lançamentos em período fechado" htmlFor="blockClosed">
          <ToggleField id="blockClosed" label="Bloquear período fechado" checked={values.blockPostingClosedPeriod} onCheckedChange={(v) => onChange("blockPostingClosedPeriod", v)} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function PdvSection({ values, onChange }: SectionProps) {
  const prod = values.nfceEnvironment === "production"
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="PDV & NFC-e" description="Configurações do terminal de frente de caixa e emissão fiscal." />
      <SettingsCard
        title="Terminal"
        action={<Badge variant="outline" className={cn("text-[10px]", prod ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400")}>{prod ? "Produção" : "Homologação"}</Badge>}
      >
        <SettingRow label="Nome do terminal" htmlFor="terminalName">
          <TextField id="terminalName" value={values.terminalName} onChange={(v) => onChange("terminalName", v)} />
        </SettingRow>
        <SettingRow label="Série da NFC-e" htmlFor="nfceSeries">
          <TextField id="nfceSeries" mono value={values.nfceSeries} onChange={(v) => onChange("nfceSeries", v)} />
        </SettingRow>
        <SettingRow label="Ambiente fiscal" hint="Em homologação as notas não têm valor fiscal." htmlFor="nfceEnv">
          <SelectField id="nfceEnv" value={values.nfceEnvironment} onValueChange={(v) => onChange("nfceEnvironment", v as SettingsValues["nfceEnvironment"])} options={[
            { value: "homologation", label: "Homologação (testes)" },
            { value: "production", label: "Produção" },
          ]} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Impressão">
        <SettingRow label="Impressora térmica" htmlFor="printerModel">
          <TextField id="printerModel" value={values.printerModel} onChange={(v) => onChange("printerModel", v)} />
        </SettingRow>
        <SettingRow label="Largura da bobina" htmlFor="printerWidth">
          <SelectField id="printerWidth" value={values.printerWidth} onValueChange={(v) => onChange("printerWidth", v as SettingsValues["printerWidth"])} options={[
            { value: "58", label: "58 mm" },
            { value: "80", label: "80 mm" },
          ]} />
        </SettingRow>
        <SettingRow label="Imprimir cupom automaticamente" htmlFor="autoPrint">
          <ToggleField id="autoPrint" label="Imprimir automaticamente" checked={values.autoPrintReceipt} onCheckedChange={(v) => onChange("autoPrintReceipt", v)} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Regras de venda">
        <SettingRow label="Exigir CPF/CNPJ na nota" htmlFor="reqDoc">
          <ToggleField id="reqDoc" label="Exigir documento" checked={values.requireCustomerDocument} onCheckedChange={(v) => onChange("requireCustomerDocument", v)} />
        </SettingRow>
        <SettingRow label="Desconto máximo sem supervisor" htmlFor="maxDiscount">
          <TextField id="maxDiscount" mono suffix="%" value={values.maxDiscountPercent} onChange={(v) => onChange("maxDiscountPercent", v)} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function PaymentsSection({ values, onChange }: SectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Pagamentos" description="Meios de pagamento aceitos e chave Pix de recebimento." />
      <SettingsCard title="Pix">
        <SettingRow label="Tipo de chave" htmlFor="pixKeyType">
          <SelectField id="pixKeyType" value={values.pixKeyType} onValueChange={(v) => onChange("pixKeyType", v)} options={[
            { value: "cnpj", label: "CNPJ" },
            { value: "email", label: "E-mail" },
            { value: "phone", label: "Telefone" },
            { value: "random", label: "Chave aleatória" },
          ]} />
        </SettingRow>
        <SettingRow label="Chave Pix" htmlFor="pixKey">
          <TextField id="pixKey" mono value={values.pixKey} onChange={(v) => onChange("pixKey", v)} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Meios aceitos">
        <SettingRow label="Cartão de crédito" htmlFor="acceptCredit">
          <ToggleField id="acceptCredit" label="Crédito" checked={values.acceptCredit} onCheckedChange={(v) => onChange("acceptCredit", v)} />
        </SettingRow>
        <SettingRow label="Cartão de débito" htmlFor="acceptDebit">
          <ToggleField id="acceptDebit" label="Débito" checked={values.acceptDebit} onCheckedChange={(v) => onChange("acceptDebit", v)} />
        </SettingRow>
        <SettingRow label="Boleto bancário" htmlFor="acceptBoleto">
          <ToggleField id="acceptBoleto" label="Boleto" checked={values.acceptBoleto} onCheckedChange={(v) => onChange("acceptBoleto", v)} />
        </SettingRow>
        <SettingRow label="Parcelamento máximo" hint="Aplicado ao crédito no checkout e PDV." htmlFor="maxInstallments">
          <SelectField id="maxInstallments" value={values.maxInstallments} onValueChange={(v) => onChange("maxInstallments", v)} options={
            ["1", "2", "3", "6", "10", "12"].map((n) => ({ value: n, label: `${n}x` }))
          } />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

const LEVELS: { value: PermissionLevel; label: string }[] = [
  { value: "none", label: "Sem acesso" },
  { value: "read", label: "Leitura" },
  { value: "write", label: "Edição" },
]

export function TeamSection({ values, onChange }: SectionProps) {
  const roles = Object.keys(ROLE_LABELS) as RoleId[]
  const modules = Object.keys(MODULE_LABELS) as ModuleId[]

  const setLevel = (role: RoleId, mod: ModuleId, level: PermissionLevel) => {
    onChange("permissions", {
      ...values.permissions,
      [role]: { ...values.permissions[role], [mod]: level },
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Equipe & Permissões" description="Defina o que cada perfil pode ver e editar em cada módulo." />
      <SettingsCard title="Matriz de permissões" description="Proprietário sempre tem acesso total e não pode ser alterado.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">Perfil</th>
                {modules.map((m) => (
                  <th key={m} scope="col" className="px-2 py-2.5 font-semibold">{MODULE_LABELS[m]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {roles.map((role) => (
                <tr key={role}>
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-foreground sm:px-5">{ROLE_LABELS[role]}</th>
                  {modules.map((mod) => (
                    <td key={mod} className="px-2 py-2">
                      <Select
                        value={values.permissions[role][mod]}
                        disabled={role === "owner"}
                        onValueChange={(v) => setLevel(role, mod, v as PermissionLevel)}
                      >
                        <SelectTrigger aria-label={`${ROLE_LABELS[role]} em ${MODULE_LABELS[mod]}`} className="h-8 w-full min-w-[104px] text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </div>
  )
}

export function SecuritySection({ values, onChange }: SectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Segurança" description="Políticas de autenticação aplicadas a todos os usuários do workspace." />
      <SettingsCard title="Autenticação">
        <SettingRow label="Exigir 2FA para todos" hint="Usuários sem 2FA serão obrigados a configurar no próximo login." htmlFor="require2fa">
          <ToggleField id="require2fa" label="Exigir 2FA" checked={values.require2fa} onCheckedChange={(v) => onChange("require2fa", v)} />
        </SettingRow>
        <SettingRow label="Tamanho mínimo da senha" htmlFor="pwdLen">
          <SelectField id="pwdLen" value={values.passwordMinLength} onValueChange={(v) => onChange("passwordMinLength", v)} options={
            ["8", "10", "12", "16"].map((n) => ({ value: n, label: `${n} caracteres` }))
          } />
        </SettingRow>
        <SettingRow label="Expiração por inatividade" htmlFor="session">
          <SelectField id="session" value={values.sessionTimeoutMinutes} onValueChange={(v) => onChange("sessionTimeoutMinutes", v)} options={[
            { value: "15", label: "15 minutos" },
            { value: "60", label: "1 hora" },
            { value: "480", label: "8 horas" },
            { value: "1440", label: "24 horas" },
          ]} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard title="Restrição de rede">
        <SettingRow label="Permitir apenas IPs autorizados" htmlFor="ipEnabled">
          <ToggleField id="ipEnabled" label="Restringir por IP" checked={values.ipAllowlistEnabled} onCheckedChange={(v) => onChange("ipAllowlistEnabled", v)} />
        </SettingRow>
        {values.ipAllowlistEnabled && (
          <SettingRow label="IPs / CIDRs permitidos" hint="Um por linha. Ex.: 200.150.10.0/24" htmlFor="ipList" stacked>
            <textarea
              id="ipList"
              rows={3}
              value={values.ipAllowlist}
              onChange={(e) => onChange("ipAllowlist", e.target.value)}
              placeholder="200.150.10.0/24"
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs tabular-nums text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </SettingRow>
        )}
      </SettingsCard>
    </div>
  )
}

export function NotificationsSection({ values, onChange }: SectionProps) {
  const channels = [
    { id: "email", label: "E-mail" },
    { id: "push", label: "Push" },
    { id: "whatsapp", label: "WhatsApp" },
  ] as const

  const toggle = (event: string, channel: (typeof channels)[number]["id"], v: boolean) => {
    onChange("notifications", {
      ...values.notifications,
      [event]: { ...values.notifications[event], [channel]: v },
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Notificações" description="Escolha por quais canais cada evento deve alertar a equipe." />
      <SettingsCard title="Eventos × canais">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead>
              <tr className="bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-left font-semibold sm:px-5">Evento</th>
                {channels.map((c) => (
                  <th key={c.id} scope="col" className="w-24 px-2 py-2.5 text-center font-semibold">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {NOTIFICATION_EVENTS.map((ev) => (
                <tr key={ev.id}>
                  <th scope="row" className="px-4 py-3 text-left sm:px-5">
                    <span className="block font-medium text-foreground">{ev.label}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">{ev.hint}</span>
                  </th>
                  {channels.map((c) => (
                    <td key={c.id} className="px-2 py-3 text-center">
                      <Switch
                        checked={values.notifications[ev.id]?.[c.id] ?? false}
                        onCheckedChange={(v) => toggle(ev.id, c.id, v)}
                        aria-label={`${ev.label} por ${c.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
      <SettingsCard title="Resumo">
        <SettingRow label="Resumo semanal por e-mail" hint="Toda segunda-feira às 8h." htmlFor="digest">
          <ToggleField id="digest" label="Resumo semanal" checked={values.weeklyDigest} onCheckedChange={(v) => onChange("weeklyDigest", v)} />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

export function IntegrationsSection({ values, onChange }: SectionProps) {
  const [revealed, setRevealed] = useState(false)
  const apiKey = "atl_live_8f3a1c9d27b64e05a9d1c3f7e2b48a60"
  const shown = revealed ? apiKey : `atl_live_${"•".repeat(24)}${apiKey.slice(-4)}`

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Integrações & API" description="Conecte bancos, sistemas externos e receba eventos em tempo real." />
      <SettingsCard
        title="Open Finance"
        action={
          <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-3" /> Regulado BCB
          </Badge>
        }
      >
        <SettingRow label="Sincronização automática de extratos" hint="Consentimento renovável a cada 12 meses." htmlFor="openFinance">
          <ToggleField id="openFinance" label="Open Finance" checked={values.openFinanceEnabled} onCheckedChange={(v) => onChange("openFinanceEnabled", v)} />
        </SettingRow>
      </SettingsCard>
      <SettingsCard
        title="Chave de API"
        description="Use no header Authorization. Nunca compartilhe em repositórios."
        action={
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.success("Nova chave gerada (simulação)")}>
            <RefreshCw className="size-3.5" /> Rotacionar
          </Button>
        }
      >
        <div className="flex min-w-0 items-center gap-2 px-4 py-3.5 sm:px-5">
          <span title="Chave de API" className="shrink-0 text-muted-foreground"><KeyRound className="size-4" /></span>
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-muted/40 px-3 py-2">
            <p className="truncate font-mono text-xs tabular-nums text-muted-foreground">{shown}</p>
          </div>
          <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" onClick={() => setRevealed((r) => !r)} aria-label={revealed ? "Ocultar chave" : "Mostrar chave"}>
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" onClick={() => { void navigator.clipboard?.writeText(apiKey); toast.success("Chave copiada") }} aria-label="Copiar chave">
            <Copy className="size-3.5" />
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard title="Webhook" description="Enviamos um POST assinado (HMAC) a cada evento selecionado.">
        <SettingRow label="URL de destino" htmlFor="webhookUrl" stacked>
          <TextField id="webhookUrl" mono value={values.webhookUrl} onChange={(v) => onChange("webhookUrl", v)} />
        </SettingRow>
        {Object.entries(WEBHOOK_EVENT_LABELS).map(([id, label]) => (
          <SettingRow key={id} label={label} hint={id} htmlFor={`wh-${id}`}>
            <ToggleField
              id={`wh-${id}`}
              label={label}
              checked={values.webhookEvents[id] ?? false}
              onCheckedChange={(v) => onChange("webhookEvents", { ...values.webhookEvents, [id]: v })}
            />
          </SettingRow>
        ))}
      </SettingsCard>
    </div>
  )
}

export function BillingSection() {
  const usage = [
    { label: "Usuários", used: 8, total: 15 },
    { label: "Contas bancárias", used: 6, total: 10 },
    { label: "Terminais PDV", used: 2, total: 3 },
  ]
  return (
    <div className="flex flex-col gap-5">
      <SectionHeading title="Plano & Faturamento" description="Assinatura atual e consumo de recursos." />
      <SettingsCard
        title="Plano Business"
        description="Renova em 05/12/2026 • Cartão final 4242"
        action={<Button type="button" size="sm" className="h-8 gap-1.5 text-xs font-semibold" onClick={() => toast.info("Fluxo de upgrade (simulação)")}><Zap className="size-3.5" /> Fazer upgrade</Button>}
      >
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:px-5">
          {usage.map((u) => {
            const pct = Math.round((u.used / u.total) * 100)
            return (
              <div key={u.label} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-foreground">{u.label}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{u.used}/{u.total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", pct >= 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between px-4 py-3.5 text-xs sm:px-5">
          <span className="text-muted-foreground">Valor mensal</span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">R$ 489,00</span>
        </div>
      </SettingsCard>
      <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5 text-xs" onClick={() => toast.info("Adicionar forma de pagamento (simulação)")}>
        <Plus className="size-3.5" /> Adicionar forma de pagamento
      </Button>
    </div>
  )
}

