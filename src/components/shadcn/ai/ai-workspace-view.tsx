"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  History,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/shadcn/ui/sheet"
import {
  Conversation,
  ConversationEmptyState,
  Message,
  PromptInput,
} from "./ai-elements"
import { AIArtifactPanel } from "./ai-artifact-panel"
import { AIThreadsSidebar } from "./ai-threads-sidebar"
import {
  AI_MODELS,
  AI_PERSONAS,
  MOCK_AI_SUGGESTIONS,
  MOCK_AI_THREADS,
  type AIArtifact,
  type AIConversationThread,
  type AIMessage,
  type AIPromptSuggestion,
} from "./ai-types"

export interface AIWorkspaceViewProps {
  initialThreads?: AIConversationThread[]
  initialThreadId?: string
  initialArtifactOpen?: boolean
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function buildSimulatedResponse(
  promptText: string,
  modelId: string,
  deepThinking: boolean,
  contexts: string[]
): { message: AIMessage; artifact: AIArtifact } {
  const artifactId = `art-${Date.now()}`
  const isFiscal = /nfc|sefaz|fiscal|ncm/i.test(promptText)
  const isConciliation = /concilia|ofx|extrato|banco/i.test(promptText)

  const artifact: AIArtifact = {
    id: artifactId,
    title: isFiscal
      ? "Relatório de Conformidade Fiscal NFC-e"
      : isConciliation
        ? "Lote Sugerido de Conciliação OFX"
        : "Análise Financeira Gerada pelo Copiloto",
    subtitle: `Gerado com ${contexts.length > 0 ? contexts.join(", ") : "Escopo Global ERP"}`,
    type: isConciliation ? "reconciliation_diff" : "financial_table",
    version: "v1",
    updatedAt: `Hoje ${nowTime()}`,
    summaryMetrics: [
      { label: "Registros Analisados", value: "142 itens", trend: "neutral" },
      { label: "Impacto Estimado", value: isFiscal ? "R$ 3.840,00" : "R$ 18.420,00", trend: "up" },
      { label: "Confiabilidade", value: "98,6%", trend: "up" },
    ],
    tableData: {
      headers: ["Item / Referência", "Categoria", "Valor", "Status"],
      rows: [
        ["TX-9102 • Cliente Corporativo A", "Receita Pix", "R$ 8.200,00", "+ Conciliável"],
        ["TX-9108 • Fornecedor Cloud BR", "Infraestrutura", "- R$ 2.140,00", "- Revisar"],
        ["TX-9115 • Repasse Adquirente", "Cartão Crédito", "R$ 12.360,00", "+ Conciliável"],
      ],
    },
    codeContent: `-- Consulta executada pelo agente em modo leitura
SELECT id, description, category, amount, status
FROM financial_ledger
WHERE created_at >= NOW() - INTERVAL '30 days'
ORDER BY ABS(amount) DESC
LIMIT 25;`,
    language: "sql",
  }

  const message: AIMessage = {
    id: `msg-${Date.now()}`,
    role: "assistant",
    createdAt: nowTime(),
    modelId,
    tokensUsed: 1120,
    latencyMs: deepThinking ? 2100 : 950,
    isCheckpoint: true,
    reasoning: deepThinking
      ? {
          durationSeconds: 2.1,
          steps: [
            `Mapeando contexto solicitado: ${contexts.length > 0 ? contexts.join(", ") : "Módulos ERP Ativos"}.`,
            "Executando leitura estruturada das tabelas financeiras e cruzando divergências.",
            "Estruturando resultado tabular interativo no painel Canvas.",
          ],
        }
      : undefined,
    toolCalls: [
      {
        id: `tool-${Date.now()}`,
        name: isFiscal ? "inspect_fiscal_logs" : "analyze_financial_scope",
        label: isFiscal ? "Consultar XMLs & Logs SEFAZ" : "Consultar Lançamentos & Saldos",
        status: "completed",
        durationMs: 118,
        input: {
          promptPreview: promptText.slice(0, 72),
          contexts,
        },
        output: {
          rowsInspected: 142,
          artifactCreated: artifactId,
        },
      },
    ],
    content: `Analisei sua solicitação considerando **${contexts.length > 0 ? contexts.join(", ") : "o workspace completo"}** [1]. Os dados consolidados apontam **3 itens prioritários** para conferência imediata.\n\nAbri o detalhamento completo e a tabela estruturada no **Canvas lateral** para você inspecionar, copiar ou aplicar diretamente no sistema.`,
    sources: [
      {
        id: `src-${Date.now()}`,
        index: 1,
        title: "Base Analítica Atlas ERP",
        sourceType: isFiscal ? "fiscal" : "database",
        reference: "financial_ledger • tempo real",
        snippet: `Consulta executada às ${nowTime()} sobre 142 lançamentos ativos do período selecionado.`,
        updatedAt: `Hoje ${nowTime()}`,
      },
    ],
    artifactId,
  }

  return { message, artifact }
}

export function AIWorkspaceView({
  initialThreads = MOCK_AI_THREADS,
  initialThreadId,
  initialArtifactOpen = true,
}: AIWorkspaceViewProps) {
  const isMobile = useIsMobile()
  const [threads, setThreads] = useState<AIConversationThread[]>(initialThreads)
  const [activeThreadId, setActiveThreadId] = useState<string>(
    initialThreadId ?? initialThreads[0]?.id ?? "new-thread"
  )
  const [selectedModelId, setSelectedModelId] = useState<string>(AI_MODELS[0].id)
  const [deepThinking, setDeepThinking] = useState<boolean>(true)
  const [attachedContexts, setAttachedContexts] = useState<string[]>([
    "@Contas Bancárias",
    "@Cartões Corporativos",
  ])
  const [inputValue, setInputValue] = useState<string>("")
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState<boolean>(false)

  const initialThread =
    initialThreads.find((t) => t.id === (initialThreadId ?? initialThreads[0]?.id)) ??
    initialThreads[0]
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    initialArtifactOpen ? initialThread?.artifacts[0]?.id ?? null : null
  )

  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current)
    }
  }, [])

  const activeThread = useMemo(() => {
    const hit = threads.find((t) => t.id === activeThreadId)
    if (hit) return hit
    return {
      id: activeThreadId,
      title: "Nova Conversa",
      personaId: AI_PERSONAS[0].id,
      updatedAt: "Agora",
      totalTokens: 0,
      messages: [],
      artifacts: [],
    } satisfies AIConversationThread
  }, [threads, activeThreadId])

  const activePersona =
    AI_PERSONAS.find((p) => p.id === activeThread.personaId) ?? AI_PERSONAS[0]

  const activeArtifact = useMemo(
    () => activeThread.artifacts.find((a) => a.id === activeArtifactId) ?? null,
    [activeThread.artifacts, activeArtifactId]
  )

  const handleSelectThread = (threadId: string) => {
    setActiveThreadId(threadId)
    const found = threads.find((t) => t.id === threadId)
    setActiveArtifactId(found?.artifacts[0]?.id ?? null)
    setMobileThreadsOpen(false)
  }

  const handleNewThread = () => {
    const newId = `thread-${Date.now()}`
    const created: AIConversationThread = {
      id: newId,
      title: "Nova Conversa",
      personaId: activePersona.id,
      updatedAt: "Agora",
      pinned: false,
      totalTokens: 0,
      messages: [],
      artifacts: [],
    }
    setThreads((prev) => [created, ...prev])
    setActiveThreadId(newId)
    setActiveArtifactId(null)
    setMobileThreadsOpen(false)
  }

  const handleTogglePin = (threadId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, pinned: !t.pinned } : t))
    )
  }

  const handleSelectPersona = (personaId: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === activeThread.id ? { ...t, personaId } : t))
    )
    const label = AI_PERSONAS.find((p) => p.id === personaId)?.name ?? "Agente"
    toast.info(`Persona alterada para ${label}.`)
  }

  const handleToggleContext = (ctx: string) => {
    setAttachedContexts((prev) =>
      prev.includes(ctx) ? prev.filter((item) => item !== ctx) : [...prev, ctx]
    )
  }

  const sendMessage = (customPrompt?: string) => {
    const text = (customPrompt ?? inputValue).trim()
    if (!text || isStreaming) return

    const userMsg: AIMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: nowTime(),
      contextChips: attachedContexts.length > 0 ? [...attachedContexts] : undefined,
    }

    const exists = threads.some((t) => t.id === activeThread.id)
    const nextTitle =
      activeThread.messages.length === 0
        ? text.length > 44
          ? `${text.slice(0, 44)}...`
          : text
        : activeThread.title

    if (!exists) {
      const created: AIConversationThread = {
        ...activeThread,
        title: nextTitle,
        updatedAt: "Agora mesmo",
        messages: [userMsg],
      }
      setThreads((prev) => [created, ...prev])
    } else {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === activeThread.id
            ? {
                ...t,
                title: nextTitle,
                updatedAt: "Agora mesmo",
                messages: [...t.messages, userMsg],
              }
            : t
        )
      )
    }

    if (!customPrompt) setInputValue("")
    setIsStreaming(true)

    const targetThreadId = activeThread.id
    const snapshotContexts = [...attachedContexts]

    streamTimerRef.current = setTimeout(() => {
      const { message: assistantMsg, artifact } = buildSimulatedResponse(
        text,
        selectedModelId,
        deepThinking,
        snapshotContexts
      )

      setThreads((prev) =>
        prev.map((t) =>
          t.id === targetThreadId
            ? {
                ...t,
                totalTokens: t.totalTokens + (assistantMsg.tokensUsed ?? 900),
                messages: [...t.messages, assistantMsg],
                artifacts: [artifact, ...t.artifacts],
              }
            : t
        )
      )
      setActiveArtifactId(artifact.id)
      setIsStreaming(false)
    }, 650)
  }

  const handleStopStreaming = () => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
    setIsStreaming(false)
    toast.info("Geração interrompida pelo usuário.")
  }

  const handleApproveTool = (messageId: string, toolId: string) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== activeThread.id) return t
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== messageId) return m
            return {
              ...m,
              plan: m.plan
                ? {
                    ...m.plan,
                    steps: m.plan.steps.map((s) =>
                      s.status === "in_progress"
                        ? { ...s, status: "completed", detail: "Aprovado e executado" }
                        : s
                    ),
                  }
                : undefined,
              toolCalls: m.toolCalls?.map((tc) =>
                tc.id === toolId
                  ? {
                      ...tc,
                      status: "completed",
                      durationMs: 264,
                      output: {
                        reconciledCount: 4,
                        totalSettledBRL: 14850.0,
                        ledgerBatchId: "BATCH-2026-11-94",
                        approvedAt: nowTime(),
                      },
                    }
                  : tc
              ),
            }
          }),
        }
      })
    )
    toast.success("Ação aprovada e executada com sucesso no sistema.")
  }

  const handleRejectTool = (messageId: string, toolId: string) => {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== activeThread.id) return t
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== messageId) return m
            return {
              ...m,
              toolCalls: m.toolCalls?.map((tc) =>
                tc.id === toolId
                  ? {
                      ...tc,
                      status: "rejected",
                      output: { abortedByUser: true, rejectedAt: nowTime() },
                    }
                  : tc
              ),
            }
          }),
        }
      })
    )
    toast.info("Execução da ferramenta recusada. Nenhuma alteração foi gravada.")
  }

  const handleFeedback = (messageId: string, type: "up" | "down") => {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === messageId
                  ? { ...m, feedback: m.feedback === type ? null : type }
                  : m
              ),
            }
          : t
      )
    )
  }

  const handleRegenerate = (messageId: string) => {
    const idx = activeThread.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    const prevUser = [...activeThread.messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === "user")
    if (prevUser) {
      sendMessage(prevUser.content)
    } else {
      toast.info("Regeneração disparada para a resposta atual.")
    }
  }

  const handleRestoreCheckpoint = (messageId: string) => {
    const idx = activeThread.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeThread.id
          ? { ...t, messages: t.messages.slice(0, idx + 1) }
          : t
      )
    )
    toast.info("Conversa restaurada para este checkpoint.")
  }

  const handleSelectSuggestion = (suggestion: AIPromptSuggestion) => {
    sendMessage(suggestion.prompt)
  }

  const activeModel = AI_MODELS.find((m) => m.id === selectedModelId) ?? AI_MODELS[0]
  const firstArtifact = activeThread.artifacts[0]

  return (
    <div className="flex -my-4 md:-my-6 h-[calc(100vh-var(--header-height,3rem))] max-h-[calc(100vh-var(--header-height,3rem))] w-full overflow-hidden bg-background">
      {/* Sidebar Desktop de Threads */}
      <AIThreadsSidebar
        threads={threads}
        activeThreadId={activeThread.id}
        activePersonaId={activePersona.id}
        onSelectThread={handleSelectThread}
        onNewThread={handleNewThread}
        onTogglePin={handleTogglePin}
        onSelectPersona={handleSelectPersona}
        className="hidden lg:flex"
      />

      {/* Drawer Mobile de Threads */}
      <Sheet open={mobileThreadsOpen} onOpenChange={setMobileThreadsOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Histórico de Conversas IA</SheetTitle>
          </SheetHeader>
          <AIThreadsSidebar
            threads={threads}
            activeThreadId={activeThread.id}
            activePersonaId={activePersona.id}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onTogglePin={handleTogglePin}
            onSelectPersona={handleSelectPersona}
            className="w-full border-r-0 flex-1"
          />
        </SheetContent>
      </Sheet>

      {/* Área Central do Copiloto (Header + Conversation + PromptInput) */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar Operacional do Workspace IA */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card/50 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setMobileThreadsOpen(true)}
              aria-label="Abrir histórico de conversas"
              className="size-8 shrink-0 lg:hidden"
            >
              <History className="size-4" />
            </Button>

            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold tracking-tight text-foreground">
                  {activeThread.title}
                </h1>
                <Badge variant="outline" className="hidden sm:inline-flex text-[10px]">
                  {activePersona.name}
                </Badge>
              </div>
              <p className="truncate font-mono text-[10px] text-muted-foreground tabular-nums">
                {activeModel.name} • {activeThread.totalTokens.toLocaleString("pt-BR")} tokens na sessão
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNewThread}
              className="h-8 gap-1.5 text-xs lg:hidden"
            >
              <Plus className="size-3.5" />
              Nova
            </Button>

            {firstArtifact && (
              <Button
                type="button"
                variant={activeArtifact ? "secondary" : "outline"}
                size="sm"
                onClick={() =>
                  setActiveArtifactId((prev) =>
                    prev ? null : (activeArtifactId ?? firstArtifact.id)
                  )
                }
                className="h-8 gap-1.5 text-xs font-medium"
              >
                {activeArtifact ? (
                  <>
                    <PanelRightClose className="size-3.5" />
                    <span className="hidden sm:inline">Fechar Canvas</span>
                  </>
                ) : (
                  <>
                    <PanelRightOpen className="size-3.5" />
                    <span className="hidden sm:inline">Abrir Canvas</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </header>

        {/* Thread de Mensagens */}
        <Conversation scrollKey={`${activeThread.id}-${activeThread.messages.length}-${isStreaming}`}>
          {activeThread.messages.length === 0 ? (
            <ConversationEmptyState
              persona={activePersona}
              onSelectPersona={handleSelectPersona}
              suggestions={MOCK_AI_SUGGESTIONS}
              onSelectSuggestion={handleSelectSuggestion}
            />
          ) : (
            <>
              {activeThread.messages.map((msg) => (
                <Message
                  key={msg.id}
                  message={msg}
                  activeArtifactId={activeArtifactId}
                  artifacts={activeThread.artifacts}
                  onOpenArtifact={(id) =>
                    setActiveArtifactId((prev) => (prev === id ? null : id))
                  }
                  onApproveTool={handleApproveTool}
                  onRejectTool={handleRejectTool}
                  onRegenerate={handleRegenerate}
                  onFeedback={handleFeedback}
                  onRestoreCheckpoint={handleRestoreCheckpoint}
                />
              ))}

              {isStreaming && (
                <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card px-4 py-3 text-xs text-muted-foreground">
                  <Sparkles className="size-4 animate-pulse text-primary" />
                  <span>
                    {deepThinking
                      ? "Raciocínio profundo ativo • consultando fontes do ERP..."
                      : "Gerando resposta estruturada..."}
                  </span>
                </div>
              )}
            </>
          )}
        </Conversation>

        {/* Compositor PromptInput */}
        <PromptInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={() => sendMessage()}
          onStop={handleStopStreaming}
          isStreaming={isStreaming}
          selectedModelId={selectedModelId}
          onSelectModel={setSelectedModelId}
          deepThinking={deepThinking}
          onToggleDeepThinking={setDeepThinking}
          attachedContexts={attachedContexts}
          onToggleContext={handleToggleContext}
          usedTokens={activeThread.totalTokens}
        />
      </section>

      {/* Painel Lateral Direito Canvas / Artifact no Desktop */}
      {activeArtifact && !isMobile && (
        <AIArtifactPanel
          artifact={activeArtifact}
          artifacts={activeThread.artifacts}
          onSelectArtifact={(id) => setActiveArtifactId(id)}
          onClose={() => setActiveArtifactId(null)}
          onApplyToSystem={(art) =>
            toast.success(`Artefato "${art.title}" aplicado ao fluxo do ERP!`)
          }
        />
      )}

      {/* Sheet em telas mobile/tablet quando um artefato é aberto */}
      {isMobile && (
        <Sheet
          open={Boolean(activeArtifact)}
          onOpenChange={(open) => {
            if (!open) setActiveArtifactId(null)
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col h-full">
            <SheetHeader className="sr-only">
              <SheetTitle>{activeArtifact?.title ?? "Artefato Canvas"}</SheetTitle>
            </SheetHeader>
            {activeArtifact && (
              <AIArtifactPanel
                artifact={activeArtifact}
                artifacts={activeThread.artifacts}
                onSelectArtifact={(id) => setActiveArtifactId(id)}
                onClose={() => setActiveArtifactId(null)}
                onApplyToSystem={(art) =>
                  toast.success(`Artefato "${art.title}" aplicado ao fluxo do ERP!`)
                }
                className="w-full border-l-0 flex-1"
              />
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

