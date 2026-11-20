"use client"

import { useMemo, useState } from "react"
import { MessageSquare, Pin, PinOff, Plus, Search, Sparkles } from "lucide-react"
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
import { cn } from "@/lib/cn"
import { AI_PERSONAS, type AIConversationThread } from "./ai-types"

interface AIThreadsSidebarProps {
  threads: AIConversationThread[]
  activeThreadId: string
  activePersonaId: string
  onSelectThread: (threadId: string) => void
  onNewThread: () => void
  onTogglePin: (threadId: string) => void
  onSelectPersona: (personaId: string) => void
  className?: string
}

export function AIThreadsSidebar({
  threads,
  activeThreadId,
  activePersonaId,
  onSelectThread,
  onNewThread,
  onTogglePin,
  onSelectPersona,
  className,
}: AIThreadsSidebarProps) {
  const [search, setSearch] = useState("")

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.messages.some((m) => m.content.toLowerCase().includes(q))
        )
      : threads
    return [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }, [threads, search])

  return (
    <aside
      aria-label="Histórico de conversas com IA"
      className={cn(
        "flex w-64 shrink-0 flex-col border-r border-border/70 bg-card/40",
        className
      )}
    >
      {/* Topo com botão Nova Conversa e seletor de Persona */}
      <div className="flex flex-col gap-3 border-b border-border/70 p-3.5">
        <Button
          type="button"
          size="sm"
          onClick={onNewThread}
          className="h-9 w-full justify-center gap-1.5 text-xs font-semibold"
        >
          <Plus className="size-4" />
          Nova Conversa
        </Button>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agente / Persona
          </span>
          <Select value={activePersonaId} onValueChange={onSelectPersona}>
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PERSONAS.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <search aria-label="Filtrar conversas" className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no histórico..."
            className="h-8 w-full pl-8 text-xs"
          />
        </search>
      </div>

      {/* Lista de Threads */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-2.5">
        <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conversas ({filteredThreads.length})
        </p>

        {filteredThreads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center text-xs text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {filteredThreads.map((thread) => {
              const isActive = thread.id === activeThreadId
              const persona = AI_PERSONAS.find((p) => p.id === thread.personaId)

              return (
                <li key={thread.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelectThread(thread.id)}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-3 py-2.5 pr-8 text-left transition-all cursor-pointer",
                      isActive
                        ? "border-primary/50 bg-primary/10 text-foreground shadow-2xs"
                        : "border-transparent hover:border-border/70 hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {thread.pinned ? (
                        <Sparkles className="size-3 shrink-0 text-primary" />
                      ) : (
                        <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-xs font-semibold text-foreground">
                        {thread.title}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-medium">
                        {persona?.systemBadge ?? "IA"}
                      </Badge>
                      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        {thread.updatedAt}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-label={thread.pinned ? "Desafixar conversa" : "Fixar conversa"}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin(thread.id)
                    }}
                    className={cn(
                      "absolute right-1.5 top-2.5 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground cursor-pointer",
                      thread.pinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-100"
                    )}
                  >
                    {thread.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

