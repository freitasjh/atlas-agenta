export type FileType = "image" | "document" | "video" | "audio" | "archive" | "code" | "other"

export interface Collaborator {
  id: string
  name: string
  email: string
  avatar?: string
  role: "owner" | "editor" | "viewer"
}

export interface FolderItem {
  id: string
  name: string
  size: number // em bytes
  totalFiles: number
  isFavorited: boolean
  color?: string
  sharedWith: Collaborator[]
  createdAt: string
  updatedAt: string
}

export interface FileItem {
  id: string
  name: string
  size: number // em bytes
  type: FileType
  extension: string
  url?: string
  thumbnailUrl?: string
  isFavorited: boolean
  tags: string[]
  folderId?: string
  folderName?: string
  sharedWith: Collaborator[]
  createdAt: string
  updatedAt: string
}

export interface StorageCategory {
  type: FileType
  label: string
  size: number
  totalFiles: number
  color: string
}

export interface StorageOverviewData {
  totalCapacity: number // em bytes (ex: 100 GB)
  usedCapacity: number // em bytes
  categories: StorageCategory[]
}

// Utilitários de Formatação
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i]
}

export function formatDateBR(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date)
}

// Mock inicial realista de pastas
export const INITIAL_FOLDERS: FolderItem[] = [
  {
    id: "folder-1",
    name: "Design & Brand Assets",
    size: 14.8 * 1024 * 1024 * 1024,
    totalFiles: 142,
    isFavorited: true,
    color: "#6366f1", // Indigo
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-11-09T14:20:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "editor" },
      { id: "u2", name: "Carlos Eduardo", email: "carlos@atlas.com", role: "viewer" },
      { id: "u3", name: "Mariana Souza", email: "mariana@atlas.com", role: "viewer" },
    ],
  },
  {
    id: "folder-2",
    name: "Contratos & Propostas 2026",
    size: 2.4 * 1024 * 1024 * 1024,
    totalFiles: 38,
    isFavorited: true,
    color: "#3b82f6", // Blue
    createdAt: "2026-02-01T08:30:00Z",
    updatedAt: "2026-11-10T16:45:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
      { id: "u4", name: "Rodrigo Faro", email: "rodrigo@atlas.com", role: "editor" },
    ],
  },
  {
    id: "folder-3",
    name: "Vídeos & Gravações de Produto",
    size: 28.6 * 1024 * 1024 * 1024,
    totalFiles: 24,
    isFavorited: false,
    color: "#f59e0b", // Amber
    createdAt: "2026-03-10T12:00:00Z",
    updatedAt: "2026-11-08T11:15:00Z",
    sharedWith: [
      { id: "u2", name: "Carlos Eduardo", email: "carlos@atlas.com", role: "editor" },
    ],
  },
  {
    id: "folder-4",
    name: "Backups & Dumps de Banco",
    size: 18.2 * 1024 * 1024 * 1024,
    totalFiles: 12,
    isFavorited: false,
    color: "#10b981", // Emerald
    createdAt: "2026-04-05T09:00:00Z",
    updatedAt: "2026-11-11T03:00:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
    ],
  },
]

// Mock inicial realista de arquivos
export const INITIAL_FILES: FileItem[] = [
  {
    id: "file-1",
    name: "dashboard-v4-dark-preview.png",
    size: 3.4 * 1024 * 1024,
    type: "image",
    extension: "png",
    thumbnailUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80",
    isFavorited: true,
    tags: ["UI", "Preview", "Design System"],
    folderId: "folder-1",
    folderName: "Design & Brand Assets",
    createdAt: "2026-11-10T15:30:00Z",
    updatedAt: "2026-11-10T15:30:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
      { id: "u2", name: "Carlos Eduardo", email: "carlos@atlas.com", role: "editor" },
    ],
  },
  {
    id: "file-2",
    name: "Manual_Arquitetura_Enterprise_2026.pdf",
    size: 14.8 * 1024 * 1024,
    type: "document",
    extension: "pdf",
    isFavorited: true,
    tags: ["Documentação", "Arquitetura", "Oficial"],
    folderId: "folder-2",
    folderName: "Contratos & Propostas 2026",
    createdAt: "2026-11-08T09:15:00Z",
    updatedAt: "2026-11-09T14:20:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
      { id: "u4", name: "Rodrigo Faro", email: "rodrigo@atlas.com", role: "viewer" },
    ],
  },
  {
    id: "file-3",
    name: "Keynote_Apresentacao_Investidores.key",
    size: 42.1 * 1024 * 1024,
    type: "document",
    extension: "key",
    isFavorited: false,
    tags: ["Pitch", "Investidores", "Q4"],
    folderId: "folder-2",
    folderName: "Contratos & Propostas 2026",
    createdAt: "2026-11-05T17:00:00Z",
    updatedAt: "2026-11-07T11:45:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
    ],
  },
  {
    id: "file-4",
    name: "Video_Demonstracao_Plataforma_4K.mp4",
    size: 215.6 * 1024 * 1024,
    type: "video",
    extension: "mp4",
    isFavorited: true,
    tags: ["Marketing", "Vídeo", "Launch"],
    folderId: "folder-3",
    folderName: "Vídeos & Gravações de Produto",
    createdAt: "2026-11-02T14:00:00Z",
    updatedAt: "2026-11-06T18:20:00Z",
    sharedWith: [
      { id: "u2", name: "Carlos Eduardo", email: "carlos@atlas.com", role: "editor" },
      { id: "u3", name: "Mariana Souza", email: "mariana@atlas.com", role: "viewer" },
    ],
  },
  {
    id: "file-5",
    name: "dataset_treinamento_ia_v2.zip",
    size: 512.0 * 1024 * 1024,
    type: "archive",
    extension: "zip",
    isFavorited: false,
    tags: ["Dataset", "Machine Learning", "Dados"],
    folderId: "folder-4",
    folderName: "Backups & Dumps de Banco",
    createdAt: "2026-10-28T11:20:00Z",
    updatedAt: "2026-11-01T10:10:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
    ],
  },
  {
    id: "file-6",
    name: "relatorio_financeiro_consolidado.xlsx",
    size: 6.2 * 1024 * 1024,
    type: "document",
    extension: "xlsx",
    isFavorited: false,
    tags: ["Financeiro", "DRE", "Auditoria"],
    folderId: "folder-2",
    folderName: "Contratos & Propostas 2026",
    createdAt: "2026-11-01T08:00:00Z",
    updatedAt: "2026-11-05T13:30:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
      { id: "u4", name: "Rodrigo Faro", email: "rodrigo@atlas.com", role: "editor" },
    ],
  },
  {
    id: "file-7",
    name: "podcast_episodio_34_audio_master.mp3",
    size: 68.4 * 1024 * 1024,
    type: "audio",
    extension: "mp3",
    isFavorited: false,
    tags: ["Podcast", "Áudio", "Mídia"],
    createdAt: "2026-10-25T16:40:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
    sharedWith: [
      { id: "u3", name: "Mariana Souza", email: "mariana@atlas.com", role: "viewer" },
    ],
  },
  {
    id: "file-8",
    name: "atlas_icons_bundle_svg.zip",
    size: 22.8 * 1024 * 1024,
    type: "archive",
    extension: "zip",
    isFavorited: true,
    tags: ["Ícones", "Assets", "SVG"],
    folderId: "folder-1",
    folderName: "Design & Brand Assets",
    createdAt: "2026-11-04T12:10:00Z",
    updatedAt: "2026-11-08T09:00:00Z",
    sharedWith: [
      { id: "u1", name: "Ana Beatriz", email: "ana.beatriz@atlas.com", role: "owner" },
      { id: "u2", name: "Carlos Eduardo", email: "carlos@atlas.com", role: "editor" },
    ],
  },
]

// Mock de dados de armazenamento
export const INITIAL_STORAGE_OVERVIEW: StorageOverviewData = {
  totalCapacity: 100 * 1024 * 1024 * 1024, // 100 GB
  usedCapacity: 64.0 * 1024 * 1024 * 1024, // 64 GB (~64%)
  categories: [
    {
      type: "image",
      label: "Imagens & Fotos",
      size: 15.2 * 1024 * 1024 * 1024,
      totalFiles: 284,
      color: "#6366f1", // Indigo
    },
    {
      type: "document",
      label: "Documentos & PDFs",
      size: 18.5 * 1024 * 1024 * 1024,
      totalFiles: 195,
      color: "#3b82f6", // Blue
    },
    {
      type: "video",
      label: "Vídeos & Gravações",
      size: 22.3 * 1024 * 1024 * 1024,
      totalFiles: 42,
      color: "#f59e0b", // Amber
    },
    {
      type: "audio",
      label: "Áudios & Podcasts",
      size: 4.8 * 1024 * 1024 * 1024,
      totalFiles: 68,
      color: "#10b981", // Emerald
    },
    {
      type: "archive",
      label: "Compactados & Outros",
      size: 3.2 * 1024 * 1024 * 1024,
      totalFiles: 35,
      color: "#ec4899", // Pink
    },
  ],
}

