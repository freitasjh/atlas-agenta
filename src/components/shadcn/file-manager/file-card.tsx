import { useState } from "react"
import { 
  MoreVertical, 
  Star, 
  Share2, 
  Copy, 
  Download, 
  Trash2, 
  Info
} from "lucide-react"
import { Button } from "../ui/button"
import { Checkbox } from "../ui/checkbox"
import { Badge } from "../ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { FileIcon } from "./file-icon"
import { 
  type FileItem, 
  formatBytes, 
  formatDateBR 
} from "./file-manager-types"

interface FileCardProps {
  file: FileItem
  isSelected?: boolean
  onSelect?: (fileId: string, selected: boolean) => void
  onClick?: (file: FileItem) => void
  onToggleFavorite?: (fileId: string) => void
  onShare?: (file: FileItem) => void
  onCopyLink?: (file: FileItem) => void
  onDownload?: (file: FileItem) => void
  onDelete?: (file: FileItem) => void
}

export function FileCard({
  file,
  isSelected = false,
  onSelect,
  onClick,
  onToggleFavorite,
  onShare,
  onCopyLink,
  onDownload,
  onDelete,
}: FileCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative rounded-xl border bg-card p-4 transition-all duration-200 flex flex-col justify-between gap-3 ${
        isSelected
          ? "border-primary ring-2 ring-primary/20 shadow-sm"
          : "border-border hover:shadow-md hover:border-border/80"
      }`}
    >
      {/* Topo do Card: Checkbox, Favorito e Menu */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Checkbox de seleção */}
          <div className={`${isSelected || isHovered ? "opacity-100" : "opacity-0"} transition-opacity`}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelect?.(file.id, !!checked)}
              aria-label={`Selecionar ${file.name}`}
            />
          </div>

          <Badge variant="outline" className="text-[10px] font-mono uppercase px-1.5 py-0 h-4 bg-muted/30">
            .{file.extension}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Botão de Favoritar */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite?.(file.id)
            }}
            className={`p-1 rounded-lg transition-opacity ${
              file.isFavorited
                ? "text-amber-500 fill-amber-500 opacity-100"
                : isHovered
                ? "text-muted-foreground hover:text-foreground opacity-100"
                : "opacity-0"
            }`}
            title={file.isFavorited ? "Remover dos favoritos" : "Favoritar arquivo"}
          >
            <Star className={`h-4 w-4 ${file.isFavorited ? "fill-amber-500" : ""}`} />
          </button>

          {/* Menu Dropdown de Ações */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Opções do arquivo</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => onClick?.(file)} className="gap-2 cursor-pointer">
                <Info className="h-4 w-4" />
                Ver Detalhes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownload?.(file)} className="gap-2 cursor-pointer">
                <Download className="h-4 w-4" />
                Baixar Arquivo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShare?.(file)} className="gap-2 cursor-pointer">
                <Share2 className="h-4 w-4" />
                Compartilhar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyLink?.(file)} className="gap-2 cursor-pointer">
                <Copy className="h-4 w-4" />
                Copiar Link
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete?.(file)}
                className="gap-2 text-destructive focus:text-destructive cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Excluir Arquivo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Área Central: Preview / Thumbnail */}
      <div
        onClick={() => onClick?.(file)}
        className="cursor-pointer flex items-center justify-center rounded-lg bg-muted/30 overflow-hidden relative min-h-[110px]"
      >
        {file.type === "image" && file.thumbnailUrl ? (
          <img
            src={file.thumbnailUrl}
            alt={file.name}
            className="w-full h-28 object-cover rounded-md group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="py-4">
            <FileIcon type={file.type} extension={file.extension} className="h-12 w-12" />
          </div>
        )}
      </div>

      {/* Nome e Metadados */}
      <div 
        onClick={() => onClick?.(file)}
        className="cursor-pointer space-y-1"
      >
        <p className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatBytes(file.size)}</span>
          <span>{formatDateBR(file.updatedAt)}</span>
        </div>
      </div>

      {/* Avatares dos membros compartilhados */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="flex -space-x-1.5 overflow-hidden">
          {file.sharedWith.slice(0, 3).map((collab) => (
            <Avatar key={collab.id} className="h-5 w-5 border border-card">
              <AvatarImage src={collab.avatar} alt={collab.name} />
              <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                {collab.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>

        {file.folderName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[110px]" title={file.folderName}>
            📁 {file.folderName}
          </span>
        )}
      </div>
    </div>
  )
}
