"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import {
  ArrowDown,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Code2,
  Copy,
  Database,
  FileText,
  History,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  ShieldAlert,
  Slash,
  Sparkles,
  Square,
  Table2,
  ThumbsDown,
  ThumbsUp,
  User,
  Wrench,
  X,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import { Switch } from "@/components/shadcn/ui/switch"
import { cn } from "@/lib/cn"
import {
  AI_AVAILABLE_CONTEXTS,
  AI_MODELS,
  AI_PERSONAS,
  AI_SLASH_COMMANDS,
  type AIAgentPersona,
  type AIArtifact,
  type AIMessage,
  type AIModelOption,
  type AIPlanStep,
  type AIPromptSuggestion,
  type AISourceCitation,
  type AIToolCall,
} from "./ai-types"

/* -------------------------------------------------------------------------- */
/* 1. Conversation & ConversationEmptyState                                   */
/* -------------------------------------------------------------------------- */

interface ConversationProps {
  children: ReactNode
  scrollKey?: string | number
  className?: string
}

export function Conversation({ children, scrollKey, className }: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 180) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    }
  }, [scrollKey])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBottom(distanceFromBottom > 140)
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Histórico da conversa com inteligência artificial"
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">{children}</div>
      </div>

      {showScrollBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => scrollToBottom("smooth")}
            className="pointer-events-auto h-8 gap-1.5 rounded-full border-border/80 bg-card/95 px-3 text-xs shadow-md backdrop-blur-xs"
          >
            <ArrowDown className="size-3.5" />
            Ir para o final
          </Button>
        </div>
      )}
    </div>
  )
}

interface ConversationEmptyStateProps {
  persona: AIAgentPersona
  onSelectPersona: (personaId: string) => void
  suggestions: AIPromptSuggestion[]
  onSelectSuggestion: (suggestion: AIPromptSuggestion) => void
}

export function ConversationEmptyState({
  persona,
  onSelectPersona,
  suggestions,
  onSelectSuggestion,
}: ConversationEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center sm:py-10">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-xs">
        <Sparkles className="size-6" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        Atlas AI Workspace
      </h2>
      <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
        Copiloto conectado aos módulos do ERP com rastreabilidade de raciocínio, consulta direta às fontes e aprovação humana antes de executar ações financeiras.
      </p>

      {/* Seleção rápida de Persona */}
      <div className="mt-6 w-full text-left">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Especialidade ativa do agente
        </p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {AI_PERSONAS.map((item) => {
            const active = item.id === persona.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPersona(item.id)}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-xl border p-3 text-left transition-all cursor-pointer",
                  active
                    ? "border-primary bg-primary/10 ring-1 ring-primary/25 shadow-xs"
                    : "border-border/70 bg-card hover:border-border hover:bg-muted/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-foreground">{item.name}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {item.systemBadge}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {item.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sugestões iniciais */}
      <div className="mt-6 w-full text-left">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sugestões contextuais
        </p>
        <Suggestions suggestions={suggestions} onSelect={onSelectSuggestion} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 2. Suggestions                                                             */
/* -------------------------------------------------------------------------- */

export function Suggestions({
  suggestions,
  onSelect,
}: {
  suggestions: AIPromptSuggestion[]
  onSelect: (suggestion: AIPromptSuggestion) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {suggestions.map((sug) => (
        <button
          key={sug.id}
          type="button"
          onClick={() => onSelect(sug)}
          className="group flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-border/70 bg-card p-3.5 text-left transition-all hover:border-primary/50 hover:bg-accent/50 cursor-pointer shadow-2xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sug.category}
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] font-medium group-hover:bg-primary/15 group-hover:text-primary"
            >
              {sug.badge}
            </Badge>
          </div>
          <p className="text-xs font-semibold text-foreground">{sug.title}</p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {sug.prompt}
          </p>
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 3. Reasoning (Chain of Thought)                                            */
/* -------------------------------------------------------------------------- */

export function Reasoning({
  durationSeconds,
  steps,
  defaultOpen = false,
}: {
  durationSeconds: number
  steps: string[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/25">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
      >
        <div className="flex min-w-0 items-center gap-2">
          <BrainCircuit className="size-4 shrink-0 text-primary" />
          <span className="truncate text-xs font-semibold text-foreground">
            Raciocínio do modelo
          </span>
          <Badge variant="outline" className="font-mono text-[10px] tabular-nums">
            {durationSeconds.toFixed(1)}s • {steps.length} etapas
          </Badge>
        </div>
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/60 px-3.5 py-3">
          <ol className="flex flex-col gap-2 border-l border-border/80 pl-3.5">
            {steps.map((step, idx) => (
              <li key={`${idx}-${step.slice(0, 18)}`} className="relative text-xs leading-relaxed text-muted-foreground">
                <span className="font-mono text-[10px] font-semibold text-foreground/80 tabular-nums mr-1.5">
                  0{idx + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 4. PlanCard (Plan / Queue)                                                 */
/* -------------------------------------------------------------------------- */

export function PlanCard({
  title,
  steps,
}: {
  title: string
  steps: AIPlanStep[]
}) {
  const completedCount = steps.filter((s) => s.status === "completed").length
  const pct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <span className="truncate text-xs font-semibold text-foreground">{title}</span>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
          {completedCount}/{steps.length} concluídas
        </span>
      </div>
      <div className="h-1 w-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="divide-y divide-border/50 px-3.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              {step.status === "completed" && (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              {step.status === "in_progress" && (
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
              )}
              {step.status === "pending" && (
                <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "text-xs leading-snug",
                  step.status === "completed" ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
            {step.detail && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                {step.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 5. Tool & Confirmation (Human-in-the-Loop)                                 */
/* -------------------------------------------------------------------------- */

const TOOL_STATUS_STYLES: Record<
  AIToolCall["status"],
  { label: string; badgeClass: string }
> = {
  running: {
    label: "Executando",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
  },
  completed: {
    label: "Concluído",
    badgeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  awaiting_approval: {
    label: "Aguardando Aprovação",
    badgeClass: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  rejected: {
    label: "Recusado pelo Usuário",
    badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  error: {
    label: "Falha",
    badgeClass: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
}

export function Tool({
  toolCall,
  onApprove,
  onReject,
}: {
  toolCall: AIToolCall
  onApprove?: (toolId: string) => void
  onReject?: (toolId: string) => void
}) {
  const [expanded, setExpanded] = useState(toolCall.status === "awaiting_approval")
  const meta = TOOL_STATUS_STYLES[toolCall.status]

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-muted/20 transition-colors",
        toolCall.status === "awaiting_approval"
          ? "border-amber-500/50 bg-amber-500/5"
          : "border-border/80"
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-muted/30 cursor-pointer"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
            {toolCall.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin text-primary" />
            ) : (
              <Wrench className="size-3.5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{toolCall.label}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {toolCall.name}
              {toolCall.durationMs !== undefined ? ` • ${toolCall.durationMs}ms` : ""}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] font-semibold", meta.badgeClass)}>
            {meta.label}
          </Badge>
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="flex min-w-0 flex-col gap-3 border-t border-border/60 p-3.5">
          {toolCall.status === "awaiting_approval" && (
            <Confirmation
              summary={
                toolCall.confirmationSummary ??
                "Esta operação altera registros financeiros do sistema e exige confirmação explícita."
              }
              impactAmount={toolCall.impactAmount}
              onApprove={() => onApprove?.(toolCall.id)}
              onReject={() => onReject?.(toolCall.id)}
            />
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background p-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Input (JSON)
              </p>
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-foreground tabular-nums">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
            {toolCall.output && (
              <div className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background p-2.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Output (JSON)
                </p>
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {JSON.stringify(toolCall.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Confirmation({
  summary,
  impactAmount,
  onApprove,
  onReject,
}: {
  summary: string
  impactAmount?: string
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-background p-3.5 shadow-2xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-foreground">
              Confirmação Human-in-the-Loop Obrigatória
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{summary}</p>
          </div>
        </div>
        {impactAmount && (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-500/40 bg-amber-500/10 font-mono text-xs font-bold tabular-nums text-amber-600 dark:text-amber-400"
          >
            {impactAmount}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReject}
          className="h-8 gap-1.5 text-xs"
        >
          <XCircle className="size-3.5 text-rose-500" />
          Recusar Ação
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onApprove}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <CheckCircle2 className="size-3.5" />
          Aprovar e Executar
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 6. Sources & InlineCitation                                                */
/* -------------------------------------------------------------------------- */

export function InlineCitation({ citation }: { citation: AISourceCitation }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver fonte ${citation.index}: ${citation.title}`}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 font-mono text-[10px] font-bold text-primary align-super transition-colors hover:bg-primary hover:text-primary-foreground cursor-pointer tabular-nums"
        >
          {citation.index}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              [{citation.index}] {citation.sourceType}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {citation.updatedAt}
            </span>
          </div>
          <p className="text-xs font-bold text-foreground">{citation.title}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{citation.reference}</p>
          <p className="mt-1 rounded-md border border-border/60 bg-muted/40 p-2 text-[11px] leading-relaxed text-foreground">
            {citation.snippet}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function Sources({ sources }: { sources: AISourceCitation[] }) {
  const [open, setOpen] = useState(false)

  if (sources.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground cursor-pointer"
      >
        <Database className="size-3 text-primary" />
        <span className="font-mono tabular-nums">{sources.length}</span>
        <span>{sources.length === 1 ? "fonte consultada" : "fontes consultadas"}</span>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {sources.map((src) => (
            <div
              key={src.id}
              className="flex min-w-0 flex-col gap-1 rounded-xl border border-border/70 bg-card p-3 shadow-2xs"
            >
              <div className="flex items-center justify-between gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
                  [{src.index}] {src.sourceType}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {src.updatedAt}
                </span>
              </div>
              <p className="truncate text-xs font-semibold text-foreground">{src.title}</p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {src.reference}
              </p>
              <p className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">
                {src.snippet}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 7. ArtifactPreviewCard                                                     */
/* -------------------------------------------------------------------------- */

export function ArtifactPreviewCard({
  artifact,
  isOpen,
  onOpen,
}: {
  artifact: AIArtifact
  isOpen: boolean
  onOpen: () => void
}) {
  const Icon =
    artifact.type === "sql_query"
      ? Code2
      : artifact.type === "dre_report" || artifact.type === "financial_table"
        ? Table2
        : FileText

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all cursor-pointer shadow-2xs",
        isOpen
          ? "border-primary bg-primary/10 ring-1 ring-primary/25"
          : "border-border/80 bg-card hover:border-primary/50 hover:bg-muted/30"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-bold text-foreground">{artifact.title}</p>
            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
              {artifact.version}
            </Badge>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{artifact.subtitle}</p>
        </div>
      </div>

      <span className="shrink-0 rounded-lg border border-border/80 bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground">
        {isOpen ? "Ativo no painel" : "Abrir no Canvas"}
      </span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* 8. Message, MessageContent & MessageToolbar                                */
/* -------------------------------------------------------------------------- */

function renderInlineFormatting(text: string, sources?: AISourceCitation[]) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded border border-border/70 bg-muted/60 px-1 py-0.5 font-mono text-[11px] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    const citMatch = part.match(/^\[(\d+)\]$/)
    if (citMatch && sources) {
      const idx = Number(citMatch[1])
      const found = sources.find((s) => s.index === idx)
      if (found) {
        return <InlineCitation key={i} citation={found} />
      }
    }
    return <span key={i}>{part}</span>
  })
}

export function MessageContent({
  content,
  sources,
}: {
  content: string
  sources?: AISourceCitation[]
}) {
  const paragraphs = content.split("\n\n")
  return (
    <div className="flex flex-col gap-2.5 text-sm leading-relaxed text-foreground">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className="whitespace-pre-wrap">
          {renderInlineFormatting(paragraph, sources)}
        </p>
      ))}
    </div>
  )
}

export function MessageToolbar({
  message,
  onCopy,
  onRegenerate,
  onFeedback,
  onRestoreCheckpoint,
}: {
  message: AIMessage
  onCopy: () => void
  onRegenerate: () => void
  onFeedback: (type: "up" | "down") => void
  onRestoreCheckpoint: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          Regenerar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Avaliar positivamente"
          onClick={() => onFeedback("up")}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
            message.feedback === "up" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          )}
        >
          <ThumbsUp className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Avaliar negativamente"
          onClick={() => onFeedback("down")}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
            message.feedback === "down" && "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          )}
        >
          <ThumbsDown className="size-3" />
        </Button>
      </div>

      {message.isCheckpoint && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRestoreCheckpoint}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <History className="size-3" />
          Checkpoint
        </Button>
      )}
    </div>
  )
}

export function Message({
  message,
  activeArtifactId,
  artifacts,
  onOpenArtifact,
  onApproveTool,
  onRejectTool,
  onRegenerate,
  onFeedback,
  onRestoreCheckpoint,
}: {
  message: AIMessage
  activeArtifactId: string | null
  artifacts: AIArtifact[]
  onOpenArtifact: (artifactId: string) => void
  onApproveTool: (messageId: string, toolId: string) => void
  onRejectTool: (messageId: string, toolId: string) => void
  onRegenerate: (messageId: string) => void
  onFeedback: (messageId: string, type: "up" | "down") => void
  onRestoreCheckpoint: (messageId: string) => void
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1.5">
          {message.contextChips && message.contextChips.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.contextChips.map((chip) => (
                <Badge
                  key={chip}
                  variant="outline"
                  className="bg-card font-mono text-[10px] text-muted-foreground"
                >
                  {chip}
                </Badge>
              ))}
            </div>
          )}
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground shadow-xs">
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            Você • {message.createdAt}
          </span>
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-card text-foreground">
          <User className="size-4" />
        </div>
      </div>
    )
  }

  const modelName =
    AI_MODELS.find((m) => m.id === message.modelId)?.name ?? "Atlas Copiloto"
  const linkedArtifact = message.artifactId
    ? artifacts.find((a) => a.id === message.artifactId)
    : undefined

  return (
    <article className="flex min-w-0 items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
        <Bot className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* Cabeçalho de metadados do assistente */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-foreground">{modelName}</span>
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {message.createdAt}
          </span>
          {message.latencyMs !== undefined && (
            <Badge variant="outline" className="gap-1 font-mono text-[10px] tabular-nums">
              <Clock className="size-2.5" />
              {(message.latencyMs / 1000).toFixed(1)}s
            </Badge>
          )}
          {message.tokensUsed !== undefined && (
            <Badge variant="secondary" className="font-mono text-[10px] tabular-nums">
              {message.tokensUsed.toLocaleString("pt-BR")} tokens
            </Badge>
          )}
        </div>

        {/* Bloco Reasoning */}
        {message.reasoning && (
          <Reasoning
            durationSeconds={message.reasoning.durationSeconds}
            steps={message.reasoning.steps}
          />
        )}

        {/* Bloco Plan */}
        {message.plan && (
          <PlanCard title={message.plan.title} steps={message.plan.steps} />
        )}

        {/* Bloco Tool Calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.toolCalls.map((tc) => (
              <Tool
                key={tc.id}
                toolCall={tc}
                onApprove={(toolId) => onApproveTool(message.id, toolId)}
                onReject={(toolId) => onRejectTool(message.id, toolId)}
              />
            ))}
          </div>
        )}

        {/* Texto principal */}
        <MessageContent content={message.content} sources={message.sources} />

        {/* Artefato vinculado */}
        {linkedArtifact && (
          <ArtifactPreviewCard
            artifact={linkedArtifact}
            isOpen={activeArtifactId === linkedArtifact.id}
            onOpen={() => onOpenArtifact(linkedArtifact.id)}
          />
        )}

        {/* Fontes */}
        {message.sources && message.sources.length > 0 && (
          <Sources sources={message.sources} />
        )}

        {/* Barra de ações da mensagem */}
        <MessageToolbar
          message={message}
          onCopy={() => {
            void navigator.clipboard?.writeText(message.content)
            toast.success("Resposta copiada para a área de transferência.")
          }}
          onRegenerate={() => onRegenerate(message.id)}
          onFeedback={(type) => onFeedback(message.id, type)}
          onRestoreCheckpoint={() => onRestoreCheckpoint(message.id)}
        />
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------- */
/* 9. PromptInput, ModelSelector & ContextIndicator                           */
/* -------------------------------------------------------------------------- */

export function ModelSelector({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (modelId: string) => void
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label="Selecionar modelo de IA"
        className="h-8 w-full sm:w-[200px] border-border/70 bg-background text-xs font-medium"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AI_MODELS.map((m: AIModelOption) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            <span className="flex items-center gap-2">
              <span className="font-medium">{m.name}</span>
              <span className="text-[10px] text-muted-foreground">({m.badge})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ContextIndicator({
  usedTokens,
  maxTokens,
}: {
  usedTokens: number
  maxTokens: number
}) {
  const pct = maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0
  const formatCompact = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(n)

  return (
    <div
      title="Utilização da janela de contexto"
      className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1"
    >
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 80 ? "bg-amber-500" : "bg-primary"
          )}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatCompact(usedTokens)} / {formatCompact(maxTokens)} • {pct}%
      </span>
    </div>
  )
}

interface PromptInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isStreaming: boolean
  selectedModelId: string
  onSelectModel: (modelId: string) => void
  deepThinking: boolean
  onToggleDeepThinking: (enabled: boolean) => void
  attachedContexts: string[]
  onToggleContext: (ctx: string) => void
  usedTokens: number
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModelId,
  onSelectModel,
  deepThinking,
  onToggleDeepThinking,
  attachedContexts,
  onToggleContext,
  usedTokens,
}: PromptInputProps) {
  const [slashOpen, setSlashOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const selectedModel = AI_MODELS.find((m) => m.id === selectedModelId) ?? AI_MODELS[0]

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!isStreaming && value.trim()) {
        onSubmit()
      }
    }
  }

  return (
    <div className="border-t border-border/70 bg-background/95 px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-border/80 bg-card p-3 shadow-xs focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
        {/* Pílulas de Contexto Ativo */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Popover open={contextOpen} onOpenChange={setContextOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 rounded-full border-dashed px-2 text-[11px] font-medium"
              >
                <Paperclip className="size-3" />
                Contexto
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Anexar escopo do sistema
              </p>
              <div className="flex flex-col gap-0.5">
                {AI_AVAILABLE_CONTEXTS.map((ctx) => {
                  const active = attachedContexts.includes(ctx)
                  return (
                    <button
                      key={ctx}
                      type="button"
                      onClick={() => onToggleContext(ctx)}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-accent cursor-pointer"
                    >
                      <span className="font-mono text-[11px]">{ctx}</span>
                      {active && <Check className="size-3.5 text-primary" />}
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={slashOpen} onOpenChange={setSlashOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Slash className="size-3" />
                Comandos
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Slash Commands Rápidos
              </p>
              <div className="flex flex-col gap-1">
                {AI_SLASH_COMMANDS.map((cmd) => (
                  <button
                    key={cmd.command}
                    type="button"
                    onClick={() => {
                      onChange(cmd.templatePrompt)
                      setSlashOpen(false)
                    }}
                    className="flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-primary">
                        {cmd.command}
                      </span>
                      <span className="text-xs font-semibold text-foreground">{cmd.label}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{cmd.description}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {attachedContexts.map((ctx) => (
            <Badge
              key={ctx}
              variant="secondary"
              className="gap-1 rounded-full py-0.5 pl-2 pr-1 font-mono text-[10px]"
            >
              {ctx}
              <button
                type="button"
                aria-label={`Remover contexto ${ctx}`}
                onClick={() => onToggleContext(ctx)}
                className="rounded-full p-0.5 hover:bg-background/80 cursor-pointer"
              >
                <X className="size-2.5" />
              </button>
            </Badge>
          ))}
        </div>

        {/* Textarea Principal */}
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pergunte sobre faturas, conciliação OFX, DRE ou digite um comando..."
          aria-label="Campo de mensagem para o copiloto de IA"
          className="min-h-[52px] max-h-40 w-full min-w-0 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />

        {/* Barra Inferior: Modelo, Raciocínio, Contexto & Botão Enviar/Parar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <ModelSelector value={selectedModelId} onValueChange={onSelectModel} />

            <div className="flex items-center gap-1.5">
              <Switch
                id="ai-deep-thinking"
                checked={deepThinking}
                onCheckedChange={onToggleDeepThinking}
                disabled={!selectedModel.supportsReasoning}
              />
              <label
                htmlFor="ai-deep-thinking"
                className="cursor-pointer text-[11px] font-medium text-muted-foreground select-none"
              >
                Pensamento Profundo
              </label>
            </div>

            <div className="hidden sm:block">
              <ContextIndicator
                usedTokens={usedTokens}
                maxTokens={selectedModel.contextWindow}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onStop}
                className="h-8 gap-1.5 px-3 text-xs font-semibold"
              >
                <Square className="size-3 fill-current" />
                Parar Geração
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!value.trim()}
                onClick={onSubmit}
                className="h-8 gap-1.5 px-3.5 text-xs font-semibold"
              >
                <Send className="size-3.5" />
                Enviar
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

