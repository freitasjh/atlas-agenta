import { 
  MoreVertical, 
  Star, 
  Share2, 
  Copy, 
  Download, 
  Trash2, 
  Info,
  ArrowUpDown
} from "lucide-react"
import { Button } from "../ui/button"
import { Checkbox } from "../ui/checkbox"
import { Badge } from "../ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table"
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

interface FileTableProps {
  files: FileItem[]
  selectedIds: string[]
  onSelectAll: (checked: boolean) => void
  onSelectFile: (fileId: string, checked: boolean) => void
  onOpenFileDetails: (file: FileItem) => void
  onToggleFavorite: (fileId: string) => void
  onShare: (file: FileItem) => void
  onCopyLink: (file: FileItem) => void
  onDownload: (file: FileItem) => void
  onDelete: (file: FileItem) => void
}

export function FileTable({
  files,
  selectedIds,
  onSelectAll,
  onSelectFile,
  onOpenFileDetails,
  onToggleFavorite,
  onShare,
  onCopyLink,
  onDownload,
  onDelete,
}: FileTableProps) {
  const allSelected = files.length > 0 && selectedIds.length === files.length
  const someSelected = selectedIds.length > 0 && selectedIds.length < files.length

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 pl-4">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(checked) => onSelectAll(!!checked)}
                aria-label="Selecionar todos os arquivos"
              />
            </TableHead>
            <TableHead className="min-w-[240px]">
              <span className="flex items-center gap-1 font-semibold text-xs">
                Nome
                <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
              </span>
            </TableHead>
            <TableHead className="w-28 font-semibold text-xs">Tamanho</TableHead>
            <TableHead className="w-28 font-semibold text-xs">Tipo</TableHead>
            <TableHead className="w-36 font-semibold text-xs">Modificado em</TableHead>
            <TableHead className="w-36 font-semibold text-xs">Compartilhado</TableHead>
            <TableHead className="w-12 text-center font-semibold text-xs"></TableHead>
            <TableHead className="w-12 pr-4"></TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {files.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                Nenhum arquivo encontrado nesta pasta ou com os filtros selecionados.
              </TableCell>
            </TableRow>
          ) : (
            files.map((file) => {
              const isSelected = selectedIds.includes(file.id)

              return (
                <TableRow
                  key={file.id}
                  data-state={isSelected ? "selected" : undefined}
                  className="group hover:bg-muted/40 transition-colors"
                >
                  <TableCell className="pl-4">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => onSelectFile(file.id, !!checked)}
                      aria-label={`Selecionar ${file.name}`}
                    />
                  </TableCell>

                  {/* Nome com Ícone */}
                  <TableCell>
                    <div 
                      onClick={() => onOpenFileDetails(file)}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <div className="shrink-0">
                        <FileIcon type={file.type} extension={file.extension} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-xs text-foreground truncate group-hover:text-primary transition-colors max-w-xs md:max-w-md">
                          {file.name}
                        </p>
                        {file.folderName && (
                          <span className="text-[10px] text-muted-foreground">
                            📁 {file.folderName}
                          </span>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Tamanho */}
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {formatBytes(file.size)}
                  </TableCell>

                  {/* Tipo */}
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono uppercase px-1.5 py-0 h-4 bg-muted/30">
                      .{file.extension}
                    </Badge>
                  </TableCell>

                  {/* Data */}
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateBR(file.updatedAt)}
                  </TableCell>

                  {/* Colaboradores */}
                  <TableCell>
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {file.sharedWith.slice(0, 3).map((collab) => (
                        <Avatar key={collab.id} className="h-5 w-5 border border-card">
                          <AvatarImage src={collab.avatar} alt={collab.name} />
                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                            {collab.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {file.sharedWith.length > 3 && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted border border-card text-[8px] font-medium text-muted-foreground">
                          +{file.sharedWith.length - 3}
                        </div>
                      )}
                    </div>
                  </TableCell>

                  {/* Favorito */}
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(file.id)}
                      className={`p-1 rounded-md transition-opacity ${
                        file.isFavorited
                          ? "text-amber-500 fill-amber-500 opacity-100"
                          : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                      }`}
                    >
                      <Star className={`h-4 w-4 ${file.isFavorited ? "fill-amber-500" : ""}`} />
                    </button>
                  </TableCell>

                  {/* Ações */}
                  <TableCell className="pr-4 text-right">
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
                        <DropdownMenuItem onClick={() => onOpenFileDetails(file)} className="gap-2 cursor-pointer">
                          <Info className="h-4 w-4" />
                          Ver Detalhes
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDownload(file)} className="gap-2 cursor-pointer">
                          <Download className="h-4 w-4" />
                          Baixar Arquivo
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onShare(file)} className="gap-2 cursor-pointer">
                          <Share2 className="h-4 w-4" />
                          Compartilhar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onCopyLink(file)} className="gap-2 cursor-pointer">
                          <Copy className="h-4 w-4" />
                          Copiar Link
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(file)}
                          className="gap-2 text-destructive focus:text-destructive cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                          Excluir Arquivo
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
