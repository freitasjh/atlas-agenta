import {
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  File,
  Folder,
} from "lucide-react"
import { type FileType } from "./file-manager-types"

interface FileIconProps {
  type: FileType | "folder"
  extension?: string
  className?: string
  color?: string
}

export function FileIcon({ type, extension, className = "h-8 w-8", color }: FileIconProps) {
  const ext = extension?.toLowerCase()

  if (type === "folder") {
    return (
      <div 
        className="flex items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 p-2.5 transition-transform hover:scale-105"
        style={color ? { backgroundColor: `${color}15`, color } : undefined}
      >
        <Folder className={className} fill="currentColor" fillOpacity={0.2} />
      </div>
    )
  }

  // Extensões de planilha
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    return (
      <div className="flex items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-2.5">
        <FileSpreadsheet className={className} />
      </div>
    )
  }

  // Extensões de código
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "json" || ext === "html" || ext === "css") {
    return (
      <div className="flex items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 p-2.5">
        <FileCode className={className} />
      </div>
    )
  }

  switch (type) {
    case "image":
      return (
        <div className="flex items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 p-2.5">
          <FileImage className={className} />
        </div>
      )
    case "video":
      return (
        <div className="flex items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 p-2.5">
          <FileVideo className={className} />
        </div>
      )
    case "audio":
      return (
        <div className="flex items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-2.5">
          <FileAudio className={className} />
        </div>
      )
    case "archive":
      return (
        <div className="flex items-center justify-center rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400 p-2.5">
          <FileArchive className={className} />
        </div>
      )
    case "document":
      return (
        <div className="flex items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 p-2.5">
          <FileText className={className} />
        </div>
      )
    default:
      return (
        <div className="flex items-center justify-center rounded-xl bg-muted text-muted-foreground p-2.5">
          <File className={className} />
        </div>
      )
  }
}

