"use client"

import { useState } from "react"
import { Bell, CheckCheck, Mail, MailOpen, X, BellOff } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover"
import { ScrollArea } from "@/components/shadcn/ui/scroll-area"
import { Separator } from "@/components/shadcn/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs"
import { cn } from "@/lib/cn"

type Severity = "critical" | "info" | "audit"
type NotificationTab = "all" | Severity

type NotificationItem = {
  id: string
  title: string
  body: string
  time: string
  severity: Severity
  tag: string
  read: boolean
}

const seed: NotificationItem[] = [
  {
    id: "n1",
    title: "Limite Bacen próximo do teto",
    body: "Utilização de 87% da faixa operacional DI — revisar tesouraria.",
    time: "há 4 min",
    severity: "critical",
    tag: "Bacen",
    read: false,
  },
  {
    id: "n2",
    title: "Webhook de liquidação falhou",
    body: "Integração Stone retornou 502 em 3 tentativas. Fila com retry ativo.",
    time: "há 26 min",
    severity: "critical",
    tag: "Webhooks",
    read: false,
  },
  {
    id: "n3",
    title: "Fechamento 11/26 conciliado",
    body: "124 de 132 lançamentos matched automaticamente.",
    time: "há 1 h",
    severity: "info",
    tag: "Conciliação",
    read: false,
  },
  {
    id: "n4",
    title: "Trilha de auditoria exportada",
    body: "Relatório Q3 assinado e arquivado com carimbo de tempo.",
    time: "há 3 h",
    severity: "audit",
    tag: "Auditoria",
    read: true,
  },
  {
    id: "n5",
    title: "Novo usuário aprovado",
    body: "Marina Souza recebeu perfil Operador Tesouraria.",
    time: "ontem",
    severity: "audit",
    tag: "Acesso",
    read: true,
  },
]

const tabs: Array<{ id: NotificationTab; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "critical", label: "Críticas" },
  { id: "audit", label: "Auditoria" },
]

function SeverityBadge({ severity, tag }: { severity: Severity; tag: string }) {
  if (severity === "critical") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-300">
        <span className="size-1.5 rounded-full bg-rose-500 animate-pulse" />
        {tag}
      </span>
    )
  }
  if (severity === "info") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300">
        <span className="size-1.5 rounded-full bg-sky-500" />
        {tag}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
      <span className="size-1.5 rounded-full bg-amber-500" />
      {tag}
    </span>
  )
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<NotificationTab>("all")
  const [items, setItems] = useState<NotificationItem[]>(seed)

  const unread = items.filter((item) => !item.read).length
  const criticalUnread = items.filter((item) => !item.read && item.severity === "critical").length
  const visible = items.filter((item) => tab === "all" || item.severity === tab)

  function toggleRead(id: string): void {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, read: !item.read } : item
      )
    )
  }

  function dismiss(id: string): void {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }

  function markAllRead(): void {
    setItems((prev) => prev.map((item) => ({ ...item, read: true })))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-8 rounded-lg hover:bg-muted/60"
          aria-label={`Notificações, ${unread} não lidas`}
        >
          <Bell className="size-4 text-foreground/80" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white ring-2 ring-background">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="relative w-[min(92vw,380px)] overflow-hidden rounded-xl border border-border/70 p-0 shadow-[0_4px_16px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.06)] dark:border-border/60 dark:shadow-none"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
        />
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold tracking-tight">Notificações</p>
            <p className="text-xs text-muted-foreground">
              {unread === 0 ? "Tudo em dia." : `${unread} não lidas`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={markAllRead}
            disabled={unread === 0}
          >
            <CheckCheck data-icon="inline-start" className="size-3.5" />
            Marcar todas
          </Button>
        </div>

        <div className="px-4 pb-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as NotificationTab)}
          >
            <TabsList className="w-full">
              {tabs.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="flex-1 text-xs">
                  {item.label}
                  {item.id === "critical" && criticalUnread > 0 && (
                    <span className="ml-1 rounded-full bg-rose-500/20 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                      {criticalUnread}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <Separator />

        <ScrollArea className="h-[320px]">
          <ul className="flex flex-col gap-1.5 p-2">
            {visible.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "group relative flex flex-col gap-1 rounded-lg border p-3 transition-colors",
                  item.read
                    ? "border-transparent bg-transparent opacity-65 hover:bg-muted/30"
                    : "border-border/60 bg-muted/20 shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:bg-muted/35"
                )}
              >
                {!item.read && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1.5 top-3.5 size-1.5 rounded-full bg-primary"
                  />
                )}
                <div className="flex items-start justify-between gap-2 pl-2">
                  <SeverityBadge severity={item.severity} tag={item.tag} />
                  <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => toggleRead(item.id)}
                      aria-label={
                        item.read ? "Marcar como não lida" : "Marcar como lida"
                      }
                    >
                      {item.read ? <Mail className="size-3.5" /> : <MailOpen className="size-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => dismiss(item.id)}
                      aria-label={`Descartar ${item.title}`}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="mt-1 pl-2 text-sm font-medium tracking-tight text-foreground/95">
                  {item.title}
                </p>
                <p className="pl-2 text-xs leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
                <p className="mt-1 pl-2 font-code text-[11px] text-muted-foreground/80">
                  {item.time}
                </p>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 p-8 text-center text-muted-foreground">
                <BellOff className="size-6 text-muted-foreground/50" />
                <p className="text-sm font-medium">Caixa zerada</p>
                <p className="text-xs">Não há notificações para exibir nesta categoria.</p>
              </li>
            )}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
