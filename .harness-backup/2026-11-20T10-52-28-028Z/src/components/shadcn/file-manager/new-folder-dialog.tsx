import { useState, type FormEvent } from "react"
import { FolderPlus } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"

interface NewFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateFolder: (name: string, color: string) => void
}

const FOLDER_COLORS = [
  { label: "Índigo", value: "#6366f1" },
  { label: "Azul", value: "#3b82f6" },
  { label: "Âmbar", value: "#f59e0b" },
  { label: "Esmeralda", value: "#10b981" },
  { label: "Rosa", value: "#ec4899" },
  { label: "Roxo", value: "#8b5cf6" },
]

export function NewFolderDialog({
  open,
  onOpenChange,
  onCreateFolder,
}: NewFolderDialogProps) {
  const [folderName, setFolderName] = useState("")
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0].value)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!folderName.trim()) return

    onCreateFolder(folderName.trim(), selectedColor)
    setFolderName("")
    setSelectedColor(FOLDER_COLORS[0].value)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-primary" />
              Criar Nova Pasta
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Insira o nome e selecione uma cor de identificação para a sua nova pasta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="folder-name" className="text-xs font-medium text-foreground">
                Nome da Pasta *
              </Label>
              <Input
                id="folder-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="Ex: Campanhas de Marketing Q4"
                className="w-full text-xs h-9"
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground">
                Cor de Identificação
              </Label>
              <div className="flex items-center gap-3 pt-1">
                {FOLDER_COLORS.map((col) => (
                  <button
                    key={col.value}
                    type="button"
                    onClick={() => setSelectedColor(col.value)}
                    className={`h-7 w-7 rounded-full transition-transform ${
                      selectedColor === col.value
                        ? "ring-2 ring-primary ring-offset-2 scale-110"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: col.value }}
                    title={col.label}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-3 sm:gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFolderName("")
                onOpenChange(false)
              }}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={!folderName.trim()}
              className="min-w-[100px]"
            >
              Criar Pasta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

