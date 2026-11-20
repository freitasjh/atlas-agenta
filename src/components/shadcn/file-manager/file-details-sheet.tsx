import { useState, type FormEvent } from "react"
import { 
  Download, 
  Copy, 
  Trash2, 
  Star, 
  Tag, 
  Calendar, 
  HardDrive, 
  FileText, 
  Folder, 
  UserPlus, 
  Check, 
  Plus
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Input } from "../ui/input"
import { Separator } from "../ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"
import { FileIcon } from "./file-icon"
import { 
  type FileItem, 
  formatBytes, 
  formatDateBR 
} from "./file-manager-types"

interface FileDetailsSheetProps {
  file: FileItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleFavorite?: (fileId: string) => void
  onDownload?: (file: FileItem) => void
  onCopyLink?: (file: FileItem) => void
  onShare?: (file: FileItem) => void
  onDelete?: (file: FileItem) => void
  onAddTag?: (fileId: string, tag: string) => void
  onRemoveTag?: (fileId: string, tag: string) => void
}

export function FileDetailsSheet({
  file,
  open,
  onOpenChange,
  onToggleFavorite,
  onDownload,
  onCopyLink,
  onShare,
  onDelete,
  onAddTag,
  onRemoveTag,
}: FileDetailsSheetProps) {
  const [newTagInput, setNewTagInput] = useState("")
  const [copiedLink, setCopiedLink] = useState(false)

  if (!file) return null

  const handleCopyLink = () => {
    onCopyLink?.(file)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const handleAddTagSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!newTagInput.trim()) return
    onAddTag?.(file.id, newTagInput.trim())
    setNewTagInput("")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md p-0 flex flex-col justify-between overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* Header do Drawer */}
          <SheetHeader className="space-y-1 text-left">
            <div className="flex items-center justify-between pr-6">
              <Badge variant="outline" className="text-xs font-mono uppercase bg-muted/30">
                .{file.extension}
              </Badge>

              <button
                type="button"
                onClick={() => onToggleFavorite?.(file.id)}
                className={`p-1.5 rounded-lg transition-colors ${
                  file.isFavorited ? "text-amber-500 fill-amber-500" : "text-muted-foreground hover:text-foreground"
                }`}
                title={file.isFavorited ? "Remover dos favoritos" : "Favoritar"}
              >
                <Star className={`h-4 w-4 ${file.isFavorited ? "fill-amber-500" : ""}`} />
              </button>
            </div>

            <SheetTitle className="text-base font-bold text-foreground break-all leading-tight">
              {file.name}
            </SheetTitle>
          </SheetHeader>

          {/* Preview do Arquivo */}
          <div className="rounded-xl border border-border bg-muted/20 overflow-hidden flex items-center justify-center min-h-[160px] relative">
            {file.type === "image" && file.thumbnailUrl ? (
              <img
                src={file.thumbnailUrl}
                alt={file.name}
                className="w-full h-44 object-cover"
              />
            ) : (
              <div className="py-6 flex flex-col items-center gap-2">
                <FileIcon type={file.type} extension={file.extension} className="h-16 w-16" />
                <span className="text-xs text-muted-foreground font-mono">
                  {formatBytes(file.size)}
                </span>
              </div>
            )}
          </div>

          {/* Propriedades / Metadados */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Propriedades
            </h4>

            <div className="rounded-lg border border-border/60 divide-y divide-border/60 text-xs">
              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <HardDrive className="h-3.5 w-3.5 text-primary" />
                  Tamanho
                </span>
                <span className="font-mono font-medium text-foreground">
                  {formatBytes(file.size)}
                </span>
              </div>

              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Tipo de Arquivo
                </span>
                <span className="font-medium text-foreground uppercase">
                  {file.type} (.{file.extension})
                </span>
              </div>

              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Folder className="h-3.5 w-3.5 text-primary" />
                  Localização
                </span>
                <span className="font-medium text-foreground">
                  {file.folderName || "Raiz / Arquivos"}
                </span>
              </div>

              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  Modificado em
                </span>
                <span className="font-medium text-foreground">
                  {formatDateBR(file.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Seção de Tags */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" />
              Tags
            </h4>

            <div className="flex flex-wrap items-center gap-1.5">
              {file.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs py-0.5 px-2 gap-1 group/tag"
                >
                  <span>{tag}</span>
                  {onRemoveTag && (
                    <button
                      type="button"
                      onClick={() => onRemoveTag(file.id, tag)}
                      className="text-muted-foreground hover:text-foreground ml-0.5"
                    >
                      ×
                    </button>
                  )}
                </Badge>
              ))}

              {/* Form para adicionar tag */}
              {onAddTag && (
                <form onSubmit={handleAddTagSubmit} className="flex items-center gap-1">
                  <Input
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    placeholder="+ Tag..."
                    className="h-6 w-20 text-[11px] px-2"
                  />
                  {newTagInput && (
                    <Button type="submit" size="icon" variant="ghost" className="h-6 w-6">
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </form>
              )}
            </div>
          </div>

          <Separator />

          {/* Seção de Membros Compartilhados */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Compartilhado com ({file.sharedWith.length})
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onShare?.(file)}
                className="h-7 px-2 text-xs text-primary gap-1"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Convidar
              </Button>
            </div>

            <div className="space-y-2">
              {file.sharedWith.map((collab) => (
                <div key={collab.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={collab.avatar} alt={collab.name} />
                      <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                        {collab.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{collab.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{collab.email}</p>
                    </div>
                  </div>

                  <Badge variant="outline" className="text-[10px] capitalize">
                    {collab.role === "owner" ? "Proprietário" : collab.role === "editor" ? "Editor" : "Leitor"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rodapé Fixo com Ações Principais */}
        <div className="p-4 border-t border-border bg-card space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => onDownload?.(file)}
              className="gap-1.5 text-xs h-9"
            >
              <Download className="h-4 w-4" />
              Baixar Arquivo
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopyLink}
              className="gap-1.5 text-xs h-9"
            >
              {copiedLink ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar Link
                </>
              )}
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (confirm(`Tem certeza que deseja excluir "${file.name}"?`)) {
                onDelete?.(file)
                onOpenChange(false)
              }
            }}
            className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-8"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir este arquivo
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
