import { useState, useMemo } from "react"
import { toast } from "sonner"
import { Folder } from "lucide-react"
import {
  type FileItem,
  type FolderItem,
  type FileType,
  type StorageOverviewData,
  INITIAL_FILES,
  INITIAL_FOLDERS,
  INITIAL_STORAGE_OVERVIEW,
} from "./file-manager-types"
import { FileManagerHeader } from "./file-manager-header"
import { FileStorageWidget } from "./file-storage-widget"
import { FolderCard } from "./folder-card"
import { FileCard } from "./file-card"
import { FileTable } from "./file-table"
import { FileDetailsSheet } from "./file-details-sheet"
import { FileUploadDialog } from "./file-upload-dialog"
import { NewFolderDialog } from "./new-folder-dialog"

interface FileManagerViewProps {
  initialFiles?: FileItem[]
  initialFolders?: FolderItem[]
  initialStorage?: StorageOverviewData
}

export function FileManagerView({
  initialFiles = INITIAL_FILES,
  initialFolders = INITIAL_FOLDERS,
  initialStorage = INITIAL_STORAGE_OVERVIEW,
}: FileManagerViewProps) {
  // Estados principais
  const [files, setFiles] = useState<FileItem[]>(initialFiles)
  const [folders, setFolders] = useState<FolderItem[]>(initialFolders)
  const [storage] = useState<StorageOverviewData>(initialStorage)

  // Filtros e Navegação
  const [currentFolder, setCurrentFolder] = useState<FolderItem | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<FileType | "all">("all")
  const [sortBy, setSortBy] = useState<"name" | "date" | "size">("date")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  // Seleção e Modais
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [activeFileDetails, setActiveFileDetails] = useState<FileItem | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false)

  // Filtragem e Ordenação de Arquivos
  const filteredFiles = useMemo(() => {
    return files
      .filter((file) => {
        // Filtro por pasta atual (se estiver dentro de uma pasta)
        if (currentFolder && file.folderId !== currentFolder.id) {
          return false
        }

        // Filtro por tipo
        if (selectedType !== "all" && file.type !== selectedType) {
          return false
        }

        // Filtro por busca
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          return (
            file.name.toLowerCase().includes(q) ||
            file.tags.some((t) => t.toLowerCase().includes(q))
          )
        }

        return true
      })
      .sort((a, b) => {
        if (sortBy === "name") {
          return a.name.localeCompare(b.name)
        }
        if (sortBy === "size") {
          return b.size - a.size
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
  }, [files, currentFolder, selectedType, searchQuery, sortBy])

  // Filtragem de Pastas (só são exibidas na raiz se não houver pasta selecionada)
  const filteredFolders = useMemo(() => {
    if (currentFolder) return []
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return folders.filter((f) => f.name.toLowerCase().includes(q))
    }
    return folders
  }, [folders, currentFolder, searchQuery])

  // Handlers de Favoritar
  const handleToggleFavoriteFile = (fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id === fileId) {
          const nextFav = !f.isFavorited
          toast.success(nextFav ? "Arquivo adicionado aos favoritos" : "Arquivo removido dos favoritos")
          return { ...f, isFavorited: nextFav }
        }
        return f
      })
    )
  }

  const handleToggleFavoriteFolder = (folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) {
          const nextFav = !f.isFavorited
          toast.success(nextFav ? "Pasta adicionada aos favoritos" : "Pasta removida dos favoritos")
          return { ...f, isFavorited: nextFav }
        }
        return f
      })
    )
  }

  // Handlers de Ações em Arquivo
  const handleOpenFileDetails = (file: FileItem) => {
    setActiveFileDetails(file)
    setIsDetailsOpen(true)
  }

  const handleCopyLink = (file: FileItem) => {
    navigator.clipboard.writeText(`https://atlas.cloud/files/${file.id}`)
    toast.success("Link público do arquivo copiado para a área de transferência!")
  }

  const handleDownloadFile = (file: FileItem) => {
    toast.info(`Iniciando download de "${file.name}"...`)
  }

  const handleDeleteFile = (file: FileItem) => {
    setFiles((prev) => prev.filter((f) => f.id !== file.id))
    setSelectedFileIds((prev) => prev.filter((id) => id !== file.id))
    toast.success(`Arquivo "${file.name}" excluído com sucesso.`)
  }

  // Handlers de Seleção em Lote
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFileIds(filteredFiles.map((f) => f.id))
    } else {
      setSelectedFileIds([])
    }
  }

  const handleSelectFile = (fileId: string, checked: boolean) => {
    if (checked) {
      setSelectedFileIds((prev) => [...prev, fileId])
    } else {
      setSelectedFileIds((prev) => prev.filter((id) => id !== fileId))
    }
  }

  const handleBatchDownload = () => {
    toast.info(`Baixando pacote compactado com ${selectedFileIds.length} arquivos...`)
  }

  const handleBatchDelete = () => {
    if (confirm(`Tem certeza que deseja excluir ${selectedFileIds.length} arquivos selecionados?`)) {
      setFiles((prev) => prev.filter((f) => !selectedFileIds.includes(f.id)))
      toast.success(`${selectedFileIds.length} arquivos foram excluídos.`)
      setSelectedFileIds([])
    }
  }

  // Handlers de Criação
  const handleCreateFolder = (name: string, color: string) => {
    const newFolder: FolderItem = {
      id: `folder-${Date.now()}`,
      name,
      color,
      size: 0,
      totalFiles: 0,
      isFavorited: false,
      sharedWith: [
        { id: "u1", name: "Você", email: "admin@atlas.com", role: "owner" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setFolders((prev) => [newFolder, ...prev])
    toast.success(`Pasta "${name}" criada com sucesso!`)
  }

  const handleUploadComplete = (queued: { name: string; size: number; type: FileType; extension: string }[]) => {
    const newItems: FileItem[] = queued.map((q, idx) => ({
      id: `file-${Date.now()}-${idx}`,
      name: q.name,
      size: q.size,
      type: q.type,
      extension: q.extension,
      isFavorited: false,
      tags: ["Upload Recente"],
      folderId: currentFolder?.id,
      folderName: currentFolder?.name,
      sharedWith: [
        { id: "u1", name: "Você", email: "admin@atlas.com", role: "owner" },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    setFiles((prev) => [...newItems, ...prev])
    toast.success(`${queued.length} ${queued.length === 1 ? "arquivo enviado" : "arquivos enviados"} com sucesso!`)
  }

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 py-4">
      {/* Cabeçalho e Barra de Ferramentas */}
      <FileManagerHeader
        currentFolder={currentFolder}
        onNavigateRoot={() => setCurrentFolder(null)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        sortBy={sortBy}
        onSortChange={setSortBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenNewFolder={() => setIsNewFolderOpen(true)}
        selectedCount={selectedFileIds.length}
        onClearSelection={() => setSelectedFileIds([])}
        onBatchDownload={handleBatchDownload}
        onBatchDelete={handleBatchDelete}
      />

      {/* Widget de Armazenamento (visível na raiz) */}
      {!currentFolder && (
        <FileStorageWidget
          data={storage}
          onUpgrade={() => toast.info("Redirecionando para upgrade de plano e espaço...")}
        />
      )}

      {/* Seção de Pastas */}
      {filteredFolders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <Folder className="h-4 w-4 text-primary" />
              Pastas ({filteredFolders.length})
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredFolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onOpen={(f) => setCurrentFolder(f)}
                onToggleFavorite={handleToggleFavoriteFolder}
                onShare={() => toast.info(`Compartilhar pasta "${folder.name}"`)}
                onCopyLink={() => {
                  navigator.clipboard.writeText(`https://atlas.cloud/folders/${folder.id}`)
                  toast.success("Link da pasta copiado!")
                }}
                onRename={() => toast.info("Renomear pasta")}
                onDelete={() => {
                  if (confirm(`Excluir a pasta "${folder.name}"?`)) {
                    setFolders((prev) => prev.filter((f) => f.id !== folder.id))
                    toast.success("Pasta excluída!")
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Seção de Arquivos Recentes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-foreground">
            {currentFolder ? `Arquivos em "${currentFolder.name}"` : "Arquivos Recentes"}{" "}
            <span className="text-muted-foreground font-normal">({filteredFiles.length})</span>
          </h3>
        </div>

        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                isSelected={selectedFileIds.includes(file.id)}
                onSelect={(id, checked) => handleSelectFile(id, checked)}
                onClick={handleOpenFileDetails}
                onToggleFavorite={handleToggleFavoriteFile}
                onShare={() => toast.info(`Compartilhar "${file.name}"`)}
                onCopyLink={handleCopyLink}
                onDownload={handleDownloadFile}
                onDelete={handleDeleteFile}
              />
            ))}
          </div>
        ) : (
          <FileTable
            files={filteredFiles}
            selectedIds={selectedFileIds}
            onSelectAll={handleSelectAll}
            onSelectFile={handleSelectFile}
            onOpenFileDetails={handleOpenFileDetails}
            onToggleFavorite={handleToggleFavoriteFile}
            onShare={(f) => toast.info(`Compartilhar "${f.name}"`)}
            onCopyLink={handleCopyLink}
            onDownload={handleDownloadFile}
            onDelete={handleDeleteFile}
          />
        )}
      </div>

      {/* Drawer de Detalhes do Arquivo */}
      <FileDetailsSheet
        file={activeFileDetails}
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        onToggleFavorite={handleToggleFavoriteFile}
        onDownload={handleDownloadFile}
        onCopyLink={handleCopyLink}
        onDelete={handleDeleteFile}
        onAddTag={(fileId, tag) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, tags: [...f.tags, tag] } : f
            )
          )
          if (activeFileDetails?.id === fileId) {
            setActiveFileDetails((prev) =>
              prev ? { ...prev, tags: [...prev.tags, tag] } : null
            )
          }
          toast.success(`Tag "${tag}" adicionada!`)
        }}
        onRemoveTag={(fileId, tag) => {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === fileId ? { ...f, tags: f.tags.filter((t) => t !== tag) } : f
            )
          )
          if (activeFileDetails?.id === fileId) {
            setActiveFileDetails((prev) =>
              prev ? { ...prev, tags: prev.tags.filter((t) => t !== tag) } : null
            )
          }
        }}
      />

      {/* Modal de Upload */}
      <FileUploadDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUploadComplete={handleUploadComplete}
      />

      {/* Modal de Nova Pasta */}
      <NewFolderDialog
        open={isNewFolderOpen}
        onOpenChange={setIsNewFolderOpen}
        onCreateFolder={handleCreateFolder}
      />
    </div>
  )
}
