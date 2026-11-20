import { 
  Search, 
  UploadCloud, 
  FolderPlus, 
  LayoutGrid, 
  List, 
  X, 
  Download, 
  Trash2,
  ChevronRight,
  Home
} from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Badge } from "../ui/badge"
import { PillToggle } from "../ui/pill-toggle"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { type FileType, type FolderItem } from "./file-manager-types"

interface FileManagerHeaderProps {
  currentFolder?: FolderItem | null
  onNavigateRoot: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedType: FileType | "all"
  onTypeChange: (type: FileType | "all") => void
  sortBy: "name" | "date" | "size"
  onSortChange: (sort: "name" | "date" | "size") => void
  viewMode: "grid" | "list"
  onViewModeChange: (mode: "grid" | "list") => void
  onOpenUpload: () => void
  onOpenNewFolder: () => void
  selectedCount: number
  onClearSelection: () => void
  onBatchDownload: () => void
  onBatchDelete: () => void
}

export function FileManagerHeader({
  currentFolder,
  onNavigateRoot,
  searchQuery,
  onSearchChange,
  selectedType,
  onTypeChange,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  onOpenUpload,
  onOpenNewFolder,
  selectedCount,
  onClearSelection,
  onBatchDownload,
  onBatchDelete,
}: FileManagerHeaderProps) {
  const typeFilters: { label: string; value: FileType | "all" }[] = [
    { label: "Todos", value: "all" },
    { label: "Imagens", value: "image" },
    { label: "Documentos", value: "document" },
    { label: "Vídeos", value: "video" },
    { label: "Áudios", value: "audio" },
    { label: "Compactados", value: "archive" },
  ]

  return (
    <div className="space-y-4">
      {/* Linha 1: Título, Breadcrumbs e Botões de Ação */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={onNavigateRoot}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Home className="h-3.5 w-3.5" />
              <span>Arquivos</span>
            </button>

            {currentFolder && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                <span className="font-medium text-foreground">
                  {currentFolder.name}
                </span>
              </>
            )}
          </div>

          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {currentFolder ? currentFolder.name : "Gerenciador de Arquivos"}
          </h2>
        </div>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenNewFolder}
            className="h-9 gap-1.5 text-xs"
          >
            <FolderPlus className="h-4 w-4" />
            Nova Pasta
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onOpenUpload}
            className="h-9 gap-1.5 text-xs shadow-sm"
          >
            <UploadCloud className="h-4 w-4" />
            Fazer Upload
          </Button>
        </div>
      </div>

      {/* Linha 2: Busca, Filtros por Tipo, Ordenação e Toggle View */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
        {/* Barra de Busca */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar arquivos ou pastas..."
            className="pl-8 text-xs h-9 w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filtros de Tipo (Pills / Badges) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {typeFilters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              variant={selectedType === filter.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onTypeChange(filter.value)}
              className={`h-8 px-2.5 text-xs rounded-lg ${
                selectedType === filter.value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Controles do lado direito: Ordenação e Toggle Grid/List */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          {/* Seletor de Ordenação */}
          <div className="w-36">
            <Select
              value={sortBy}
              onValueChange={(val) => onSortChange(val as "name" | "date" | "size")}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Mais Recentes</SelectItem>
                <SelectItem value="name">Nome (A-Z)</SelectItem>
                <SelectItem value="size">Tamanho</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Toggle Grid vs List */}
          <PillToggle
            value={viewMode}
            onChange={(val) => onViewModeChange(val as "grid" | "list")}
            size="sm"
            aria-label="Modo de visualização"
            options={[
              { value: "grid", icon: <LayoutGrid className="size-3.5" />, title: "Visualização em Grade" },
              { value: "list", icon: <List className="size-3.5" />, title: "Visualização em Lista" },
            ]}
          />
        </div>
      </div>

      {/* Barra de Ações em Lote (quando itens estão selecionados) */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5 text-xs animate-in fade-in-50 duration-200">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs h-5 px-2">
              {selectedCount}
            </Badge>
            <span className="font-medium text-foreground">
              {selectedCount === 1 ? "arquivo selecionado" : "arquivos selecionados"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBatchDownload}
              className="h-8 text-xs gap-1.5 bg-background"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar Selecionados
            </Button>

            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onBatchDelete}
              className="h-8 text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="h-8 px-2 text-xs text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

