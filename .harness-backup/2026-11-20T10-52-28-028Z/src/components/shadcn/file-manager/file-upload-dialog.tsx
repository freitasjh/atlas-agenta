import { useState, useRef } from "react"
import { 
  UploadCloud, 
  X, 
  CheckCircle2 
} from "lucide-react"
import { Button } from "../ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { FileIcon } from "./file-icon"
import { formatBytes, type FileType } from "./file-manager-types"

interface QueuedFile {
  id: string
  file: globalThis.File
  name: string
  size: number
  type: FileType
  extension: string
  progress: number
  status: "pending" | "uploading" | "completed" | "error"
}

interface FileUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: (newFiles: QueuedFile[]) => void
}

export function FileUploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: FileUploadDialogProps) {
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Detecta tipo simples baseado na extensão
  const detectFileType = (ext: string): FileType => {
    const e = ext.toLowerCase()
    if (["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(e)) return "image"
    if (["pdf", "doc", "docx", "txt", "xlsx", "xls", "ppt", "pptx"].includes(e)) return "document"
    if (["mp4", "mov", "avi", "mkv"].includes(e)) return "video"
    if (["mp3", "wav", "ogg", "aac"].includes(e)) return "audio"
    if (["zip", "rar", "tar", "gz", "7z"].includes(e)) return "archive"
    if (["js", "ts", "tsx", "html", "css", "json", "py"].includes(e)) return "code"
    return "other"
  }

  const handleFilesAdded = (files: FileList | null) => {
    if (!files || files.length === 0) return

    const newQueue: QueuedFile[] = Array.from(files).map((f) => {
      const ext = f.name.split(".").pop() || ""
      return {
        id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file: f,
        name: f.name,
        size: f.size,
        type: detectFileType(ext),
        extension: ext,
        progress: 0,
        status: "pending",
      }
    })

    setQueuedFiles((prev) => [...prev, ...newQueue])
  }

  const handleRemoveItem = (id: string) => {
    setQueuedFiles((prev) => prev.filter((item) => item.id !== id))
  }

  const handleStartUpload = () => {
    if (queuedFiles.length === 0) return

    setIsUploading(true)

    // Simulação progressiva de upload realista
    let currentProgress = 0
    const interval = setInterval(() => {
      currentProgress += 25

      setQueuedFiles((prev) =>
        prev.map((item) => ({
          ...item,
          status: "uploading",
          progress: Math.min(100, currentProgress),
        }))
      )

      if (currentProgress >= 100) {
        clearInterval(interval)
        setIsUploading(false)
        setQueuedFiles((prev) =>
          prev.map((item) => ({
            ...item,
            status: "completed",
            progress: 100,
          }))
        )

        setTimeout(() => {
          onUploadComplete?.(queuedFiles)
          setQueuedFiles([])
          onOpenChange(false)
        }, 500)
      }
    }, 250)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            Upload de Arquivos
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Selecione ou arraste os documentos, imagens ou vídeos para armazenar na nuvem.
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone Container */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            handleFilesAdded(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
            isDragging
              ? "border-primary bg-primary/5 scale-[0.99]"
              : "border-border/80 hover:border-primary/60 hover:bg-muted/30"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="hidden"
            onChange={(e) => handleFilesAdded(e.target.files)}
          />

          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
            <UploadCloud className="h-7 w-7" />
          </div>

          <p className="text-sm font-semibold text-foreground text-center">
            Arraste e solte seus arquivos aqui
          </p>
          <p className="text-xs text-muted-foreground text-center mt-1">
            ou clique para navegar no seu computador
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-3">
            Suporta imagens, documentos, áudios e vídeos de até 50MB cada
          </p>
        </div>

        {/* Lista de Arquivos na Fila */}
        {queuedFiles.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            <p className="text-xs font-semibold text-muted-foreground">
              Fila de Upload ({queuedFiles.length})
            </p>

            <div className="divide-y divide-border/60 rounded-lg border border-border/60">
              {queuedFiles.map((item) => (
                <div key={item.id} className="p-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileIcon type={item.type} extension={item.extension} className="h-5 w-5" />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate max-w-xs">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{formatBytes(item.size)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === "uploading" && (
                      <span className="text-[10px] font-mono text-primary font-medium">
                        {item.progress}%
                      </span>
                    )}

                    {item.status === "completed" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}

                    {item.status === "pending" && !isUploading && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveItem(item.id)
                        }}
                        className="text-muted-foreground hover:text-foreground p-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-3 sm:gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={isUploading}
            onClick={() => {
              setQueuedFiles([])
              onOpenChange(false)
            }}
          >
            Cancelar
          </Button>

          <Button
            type="button"
            disabled={queuedFiles.length === 0 || isUploading}
            onClick={handleStartUpload}
            className="min-w-[120px]"
          >
            {isUploading ? "Enviando..." : `Upload (${queuedFiles.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
