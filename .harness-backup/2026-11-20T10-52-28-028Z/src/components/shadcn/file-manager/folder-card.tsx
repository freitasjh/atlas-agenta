import { useState } from "react"
import { 
  MoreVertical, 
  Star, 
  Share2, 
  Copy, 
  Edit3, 
  Trash2, 
  FolderOpen 
} from "lucide-react"
import { Button } from "../ui/button"
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
  type FolderItem, 
  formatBytes 
} from "./file-manager-types"

interface FolderCardProps {
  folder: FolderItem
  onOpen?: (folder: FolderItem) => void
  onToggleFavorite?: (folderId: string) => void
  onShare?: (folder: FolderItem) => void
  onCopyLink?: (folder: FolderItem) => void
  onRename?: (folder: FolderItem) => void
  onDelete?: (folder: FolderItem) => void
}

export function FolderCard({
  folder,
  onOpen,
  onToggleFavorite,
  onShare,
  onCopyLink,
  onRename,
  onDelete,
}: FolderCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md hover:border-border/80 flex flex-col justify-between gap-4"
    >
      {/* Linha superior: Ícone, Favorito e Menu */}
      <div className="flex items-start justify-between">
        <div 
          onClick={() => onOpen?.(folder)}
          className="cursor-pointer"
        >
          <FileIcon type="folder" color={folder.color} className="h-9 w-9" />
        </div>

        <div className="flex items-center gap-1">
          {/* Botão de Favoritar */}
          <button
            type="button"
            onClick={() => onToggleFavorite?.(folder.id)}
            className={`p-1.5 rounded-lg transition-opacity ${
              folder.isFavorited
                ? "text-amber-500 fill-amber-500 opacity-100"
                : isHovered
                ? "text-muted-foreground hover:text-foreground opacity-100"
                : "opacity-0"
            }`}
            title={folder.isFavorited ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          >
            <Star className={`h-4 w-4 ${folder.isFavorited ? "fill-amber-500" : ""}`} />
          </button>

          {/* Menu Dropdown de Ações */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Opções da pasta</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onOpen?.(folder)} className="gap-2 cursor-pointer">
                <FolderOpen className="h-4 w-4" />
                Abrir Pasta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShare?.(folder)} className="gap-2 cursor-pointer">
                <Share2 className="h-4 w-4" />
                Compartilhar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyLink?.(folder)} className="gap-2 cursor-pointer">
                <Copy className="h-4 w-4" />
                Copiar Link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRename?.(folder)} className="gap-2 cursor-pointer">
                <Edit3 className="h-4 w-4" />
                Renomear
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete?.(folder)}
                className="gap-2 text-destructive focus:text-destructive cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Excluir Pasta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Nome e Metadados */}
      <div 
        onClick={() => onOpen?.(folder)}
        className="cursor-pointer space-y-1"
      >
        <h4 className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors">
          {folder.name}
        </h4>
        <p className="text-xs text-muted-foreground">
          {formatBytes(folder.size)} • {folder.totalFiles} arquivos
        </p>
      </div>

      {/* Avatares dos membros compartilhados */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <div className="flex -space-x-2 overflow-hidden">
          {folder.sharedWith.slice(0, 3).map((collab) => (
            <Avatar key={collab.id} className="h-6 w-6 border-2 border-card">
              <AvatarImage src={collab.avatar} alt={collab.name} />
              <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                {collab.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          ))}
          {folder.sharedWith.length > 3 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted border-2 border-card text-[9px] font-medium text-muted-foreground">
              +{folder.sharedWith.length - 3}
            </div>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground">
          {folder.sharedWith.length} {folder.sharedWith.length === 1 ? "membro" : "membros"}
        </span>
      </div>
    </div>
  )
}
