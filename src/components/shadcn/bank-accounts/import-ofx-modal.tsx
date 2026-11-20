import { useState } from "react"
import {
  Upload,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Button } from "@/components/shadcn/ui/button"
import type { BankAccount } from "./bank-accounts-types"
import { toast } from "sonner"

interface ImportOFXModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: BankAccount[]
  initialAccountId?: string
  onImportSuccess: (accountId: string, count: number) => void
}

export function ImportOFXModal({
  open,
  onOpenChange,
  accounts,
  initialAccountId,
  onImportSuccess,
}: ImportOFXModalProps) {
  const [selectedAccountId, setSelectedAccountId] = useState(
    initialAccountId || accounts[0]?.id || ""
  )
  const [fileName, setFileName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleSimulatedFileSelect = () => {
    setFileName("extrato_bancario_novembro_2026.ofx")
  }

  const handleProcess = () => {
    if (!fileName) {
      toast.error("Selecione um arquivo OFX para importar.")
      return
    }

    setIsProcessing(true)
    setTimeout(() => {
      setIsProcessing(false)
      const importedCount = Math.floor(Math.random() * 8) + 5
      onImportSuccess(selectedAccountId, importedCount)
      toast.success(
        `Importação concluída! ${importedCount} lançamentos importados e conciliados.`
      )
      onOpenChange(false)
      setFileName(null)
    }, 1200)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Importar Extrato Bancário OFX
              </DialogTitle>
              <DialogDescription className="text-xs">
                Importe arquivos .OFX exportados do seu Internet Banking para conciliação automática
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Conta de Destino */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              Vincular à Conta Bancária:
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="flex w-full h-10 rounded-md border border-border/80 bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.nickname} ({acc.agency !== "---" ? `Ag: ${acc.agency} ` : ""}Cc: {acc.accountNumber})
                </option>
              ))}
            </select>
          </div>

          {/* Área de Drag & Drop do Arquivo OFX */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              setFileName(e.dataTransfer.files[0]?.name || "extrato.ofx")
            }}
            onClick={handleSimulatedFileSelect}
            className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center ${
              isDragging
                ? "border-primary bg-primary/10"
                : fileName
                ? "border-emerald-500/50 bg-emerald-500/10"
                : "border-border/80 bg-muted/20 hover:bg-muted/30"
            }`}
          >
            {fileName ? (
              <div className="space-y-1">
                <FileCode2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
                <p className="text-xs font-bold text-foreground">{fileName}</p>
                <span className="text-[10px] text-muted-foreground block">
                  Arquivo válido • Padrão Open Financial Exchange (OFX 2.0)
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFileName(null)
                  }}
                  className="text-[11px] text-destructive hover:underline mt-1 block mx-auto"
                >
                  Trocar arquivo
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mx-auto">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold text-foreground">
                  Arraste seu arquivo .OFX aqui ou clique para selecionar
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Compatível com Itaú, Bradesco, Santander, BB, Caixa, Inter e Nubank
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/30 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              O sistema identificará duplicidades e ignorará lançamentos que já foram importados anteriormente.
            </p>
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Cancelar
          </Button>

          <Button
            type="button"
            disabled={!fileName || isProcessing}
            onClick={handleProcess}
            className="text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
          >
            {isProcessing ? (
              <>
                <FileText className="h-4 w-4 animate-pulse" />
                <span>Processando Extrato...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Importar & Conciliar</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

