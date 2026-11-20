"use client"

import { useState } from "react"
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Table2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs"
import { cn } from "@/lib/cn"
import type { AIArtifact } from "./ai-types"

interface AIArtifactPanelProps {
  artifact: AIArtifact
  artifacts?: AIArtifact[]
  onSelectArtifact?: (id: string) => void
  onClose: () => void
  onApplyToSystem: (artifact: AIArtifact) => void
  className?: string
}

export function AIArtifactPanel({
  artifact,
  artifacts,
  onSelectArtifact,
  onClose,
  onApplyToSystem,
  className,
}: AIArtifactPanelProps) {
  const [tab, setTab] = useState<"preview" | "code">(
    !artifact.tableData && artifact.codeContent ? "code" : "preview"
  )
  const [version, setVersion] = useState(artifact.version)
  const [copied, setCopied] = useState(false)
  const [prevArtifactId, setPrevArtifactId] = useState(artifact.id)

  // Sincroniza versão e aba padrão quando o artefato ativo mudar
  if (artifact.id !== prevArtifactId) {
    setPrevArtifactId(artifact.id)
    setVersion(artifact.version)
    setTab(!artifact.tableData && artifact.codeContent ? "code" : "preview")
  }

  const exportText = () => {
    if (artifact.tableData && tab === "preview") {
      const header = artifact.tableData.headers.join(";")
      const rows = artifact.tableData.rows.map((r) => r.join(";")).join("\n")
      return `${header}\n${rows}`
    }
    return artifact.codeContent ?? JSON.stringify(artifact, null, 2)
  }

  const handleCopy = () => {
    void navigator.clipboard?.writeText(exportText())
    setCopied(true)
    toast.success("Conteúdo do artefato copiado.")
    setTimeout(() => setCopied(false), 1600)
  }

  const handleDownload = () => {
    const content = exportText()
    const ext = artifact.tableData && tab === "preview" ? "csv" : artifact.language ?? "txt"
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${artifact.id}-${version}.${ext}`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`Arquivo ${artifact.id}-${version}.${ext} exportado.`)
  }

  const codeLines = (
    artifact.codeContent ?? JSON.stringify(artifact.tableData ?? artifact, null, 2)
  ).split("\n")

  return (
    <aside
      aria-label={`Canvas do artefato: ${artifact.title}`}
      className={cn(
        "@container/canvas flex h-full max-h-full min-h-0 w-full shrink-0 flex-col overflow-hidden border-l border-border/70 bg-card md:w-[380px] lg:w-[440px] xl:w-[480px]",
        className
      )}
    >
      {/* Cabeçalho do Canvas */}
      <header className="flex shrink-0 flex-col gap-3 border-b border-border/70 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-semibold">
                Canvas
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {artifact.updatedAt}
              </span>
            </div>

            {/* Alternador de artefatos se a thread possuir múltiplos */}
            {artifacts && artifacts.length > 1 && onSelectArtifact ? (
              <div className="mt-1 flex items-center gap-1.5">
                <Select value={artifact.id} onValueChange={onSelectArtifact}>
                  <SelectTrigger
                    aria-label="Selecionar artefato"
                    className="h-7 w-full max-w-[280px] text-xs font-bold"
                  >
                    <Layers className="size-3 shrink-0 text-primary" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {artifacts.map((art) => (
                      <SelectItem key={art.id} value={art.id} className="text-xs">
                        {art.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <h3 className="mt-1 truncate text-sm font-bold text-foreground">
                {artifact.title}
              </h3>
            )}

            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{artifact.subtitle}</p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fechar painel de artefato"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Barra de Ferramentas do Artefato: Versão, Visualização/Código, Copiar e Baixar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger aria-label="Versão do artefato" className="h-7 w-[74px] font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="v1" className="font-mono text-xs">v1</SelectItem>
                <SelectItem value="v2" className="font-mono text-xs">v2</SelectItem>
              </SelectContent>
            </Select>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "preview" | "code")}>
              <TabsList className="h-7 p-0.5">
                <TabsTrigger value="preview" className="h-6 gap-1 px-2 text-[11px]">
                  <Table2 className="size-3" />
                  Visualização
                </TabsTrigger>
                <TabsTrigger value="code" className="h-6 gap-1 px-2 text-[11px]">
                  <Code2 className="size-3" />
                  Código / JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleCopy}
              aria-label="Copiar artefato"
              className="size-7"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleDownload}
              aria-label="Baixar arquivo do artefato"
              className="size-7"
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Corpo Rolável do Artefato com Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "preview" | "code")}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsContent
          value="preview"
          className="m-0 flex-1 overflow-y-auto overscroll-contain p-4"
        >
          <div className="flex flex-col gap-4">
            {/* Métricas Resumidas em Container Query */}
            {artifact.summaryMetrics && artifact.summaryMetrics.length > 0 && (
              <div className="grid grid-cols-1 gap-2 @[340px]/canvas:grid-cols-3">
                {artifact.summaryMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="flex min-w-0 flex-col gap-1 rounded-xl border border-border/70 bg-muted/25 p-2.5"
                  >
                    <span className="truncate text-[10px] font-medium text-muted-foreground">
                      {metric.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-bold text-foreground tabular-nums">
                        {metric.value}
                      </span>
                      {metric.trend === "up" && (
                        <TrendingUp className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      )}
                      {metric.trend === "down" && (
                        <TrendingDown className="size-3 shrink-0 text-rose-600 dark:text-rose-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tabela Analítica */}
            {artifact.tableData ? (
              <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        {artifact.tableData.headers.map((header, idx) => (
                          <TableHead
                            key={header}
                            className={cn(
                              "text-[11px] font-semibold whitespace-nowrap",
                              idx > 0 && "text-right"
                            )}
                          >
                            {header}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {artifact.tableData.rows.map((row, rowIdx) => {
                        const isLast = rowIdx === (artifact.tableData?.rows.length ?? 0) - 1
                        return (
                          <TableRow key={rowIdx} className={cn(isLast && "bg-muted/20 font-semibold")}>
                            {row.map((cell, cellIdx) => (
                              <TableCell
                                key={cellIdx}
                                className={cn(
                                  "text-xs whitespace-nowrap",
                                  cellIdx === 0
                                    ? "font-medium text-foreground"
                                    : "text-right font-mono tabular-nums",
                                  cellIdx === row.length - 1 && cell.startsWith("+")
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : cellIdx === row.length - 1 && cell.startsWith("-")
                                      ? "text-rose-600 dark:text-rose-400"
                                      : ""
                                )}
                              >
                                {cell}
                              </TableCell>
                            ))}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : artifact.codeContent ? (
              <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-2">
                  <span className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                    {artifact.language ?? "código"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    {codeLines.length} linhas
                  </span>
                </div>
                <div className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed tabular-nums">
                  {codeLines.map((line, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="w-6 shrink-0 select-none text-right text-muted-foreground/60">
                        {i + 1}
                      </span>
                      <span className="whitespace-pre text-foreground">{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent
          value="code"
          className="m-0 flex-1 overflow-y-auto overscroll-contain p-4"
        >
          <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-2">
              <span className="font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                {artifact.language ?? "json"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {codeLines.length} linhas
              </span>
            </div>
            <div className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed tabular-nums">
              {codeLines.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 select-none text-right text-muted-foreground/60">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre text-foreground">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Rodapé Fixo */}
      <footer className="flex items-center justify-between gap-2 border-t border-border/70 bg-muted/20 p-3.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className="h-8 gap-1.5 text-xs"
        >
          <Download className="size-3.5" />
          Exportar Relatório
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onApplyToSystem(artifact)}
          className="h-8 gap-1.5 text-xs font-semibold"
        >
          <ExternalLink className="size-3.5" />
          Aplicar no Sistema
        </Button>
      </footer>
    </aside>
  )
}

