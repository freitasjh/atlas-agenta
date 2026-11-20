"use client"

import { useEffect, useState } from "react"
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/shadcn/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import {
  type PaymentMethod,
  type Transaction,
  type TransactionStatus,
  type TransactionType,
  CATEGORIES_BY_TYPE,
  DEFAULT_ACCOUNTS,
  PAYMENT_METHOD_LABELS,
} from "./transaction-types"

interface TransactionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (transaction: Omit<Transaction, "id" | "createdAt"> & { id?: string }) => void
  transactionToEdit?: Transaction | null
}

export function TransactionDialog({
  open,
  onOpenChange,
  onSave,
  transactionToEdit,
}: TransactionDialogProps) {
  const isEditing = Boolean(transactionToEdit)

  const [type, setType] = useState<TransactionType>("income")
  const [description, setDescription] = useState("")
  const [amountStr, setAmountStr] = useState("")
  const [category, setCategory] = useState("")
  const [account, setAccount] = useState(DEFAULT_ACCOUNTS[0] ?? "")
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix")
  const [status, setStatus] = useState<TransactionStatus>("completed")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState("")
  const [contactName, setContactName] = useState("")
  const [documentNumber, setDocumentNumber] = useState("")
  const [notes, setNotes] = useState("")

  // Preenche dados ao editar ou reseta ao abrir para nova
  useEffect(() => {
    if (transactionToEdit) {
      setType(transactionToEdit.type)
      setDescription(transactionToEdit.description)
      setAmountStr(transactionToEdit.amount.toString())
      setCategory(transactionToEdit.category)
      setAccount(transactionToEdit.account)
      setPaymentMethod(transactionToEdit.paymentMethod)
      setStatus(transactionToEdit.status)
      setDate(transactionToEdit.date)
      setDueDate(transactionToEdit.dueDate ?? "")
      setContactName(transactionToEdit.contactName ?? "")
      setDocumentNumber(transactionToEdit.documentNumber ?? "")
      setNotes(transactionToEdit.notes ?? "")
    } else {
      setType("income")
      setDescription("")
      setAmountStr("")
      setCategory(CATEGORIES_BY_TYPE.income[0]?.name ?? "")
      setAccount(DEFAULT_ACCOUNTS[0] ?? "")
      setPaymentMethod("pix")
      setStatus("completed")
      setDate(new Date().toISOString().slice(0, 10))
      setDueDate("")
      setContactName("")
      setDocumentNumber("")
      setNotes("")
    }
  }, [transactionToEdit, open])

  // Ajusta categoria padrão ao trocar tipo
  function handleTypeChange(newType: TransactionType) {
    setType(newType)
    const availableCategories = CATEGORIES_BY_TYPE[newType]
    if (availableCategories?.[0]) {
      setCategory(availableCategories[0].name)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const parsedAmount = parseFloat(amountStr.replace(",", "."))
    if (!description.trim()) {
      toast.error("Informe uma descrição para a transação.")
      return
    }

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Informe um valor numérico válido maior que zero.")
      return
    }

    onSave({
      ...(transactionToEdit?.id ? { id: transactionToEdit.id } : {}),
      type,
      description: description.trim(),
      amount: parsedAmount,
      category: category || (CATEGORIES_BY_TYPE[type][0]?.name ?? "Geral"),
      account,
      paymentMethod,
      status,
      date,
      dueDate: dueDate || undefined,
      contactName: contactName.trim() || undefined,
      documentNumber: documentNumber.trim() || undefined,
      notes: notes.trim() || undefined,
    })

    toast.success(
      isEditing
        ? "Transação atualizada com sucesso!"
        : "Nova transação registrada com sucesso!"
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto overscroll-contain p-6 sm:max-w-xl sm:p-7"
        aria-describedby="tx-form-description"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              {isEditing ? "Editar Transação" : "Cadastrar Nova Transação"}
            </DialogTitle>
            <DialogDescription id="tx-form-description" className="text-xs text-muted-foreground">
              {isEditing
                ? "Atualize as informações financeiras da transação selecionada."
                : "Preencha os dados abaixo para registrar uma nova entrada, saída ou transferência."}
            </DialogDescription>
          </DialogHeader>

          {/* 1. Seletor de Tipo (Receita / Despesa / Transferência) */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">
              Tipo de Operação *
            </Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/60 p-1 border border-border/60">
              <button
                type="button"
                onClick={() => handleTypeChange("income")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  type === "income"
                    ? "bg-background text-emerald-600 shadow-xs dark:text-emerald-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                }`}
              >
                <ArrowUpRight className="size-3.5" />
                Receita (Entrada)
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("expense")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  type === "expense"
                    ? "bg-background text-rose-600 shadow-xs dark:text-rose-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                }`}
              >
                <ArrowDownRight className="size-3.5" />
                Despesa (Saída)
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange("transfer")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                  type === "transfer"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                }`}
              >
                <ArrowLeftRight className="size-3.5" />
                Transferência
              </button>
            </div>
          </div>

          {/* Grid de Campos Simétrico e Equilibrado (2 Colunas) */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {/* Valor (R$) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-amount" className="text-xs font-medium text-foreground">
                Valor da Transação (R$) *
              </Label>
              <div className="relative w-full">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                  R$
                </span>
                <Input
                  id="tx-amount"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className="h-10 w-full pl-10 text-base font-bold"
                  required
                  aria-required="true"
                  autoFocus
                />
              </div>
            </div>

            {/* Data de Competência */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-date" className="text-xs font-medium text-foreground">
                Data de Competência *
              </Label>
              <Input
                id="tx-date"
                name="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 w-full"
                required
                aria-required="true"
              />
            </div>

            {/* Descrição em largura total */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tx-description" className="text-xs font-medium text-foreground">
                Descrição da Transação *
              </Label>
              <Input
                id="tx-description"
                name="description"
                placeholder="Ex: Mensalidade Contrato Enterprise, Fatura Cloud AWS..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-10 w-full"
                required
                aria-required="true"
              />
            </div>

            {/* Categoria (w-full preenchendo a coluna) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-category" className="text-xs font-medium text-foreground">
                Categoria *
              </Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="tx-category" className="h-10 w-full">
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES_BY_TYPE[type].map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Conta Bancária / Caixa (w-full preenchendo a coluna) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-account" className="text-xs font-medium text-foreground">
                Conta Bancária / Caixa *
              </Label>
              <Select value={account} onValueChange={setAccount}>
                <SelectTrigger id="tx-account" className="h-10 w-full">
                  <SelectValue placeholder="Selecione a conta" />
                </SelectTrigger>
                <SelectContent>
                  {DEFAULT_ACCOUNTS.map((acc) => (
                    <SelectItem key={acc} value={acc}>
                      {acc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Meio de Pagamento (w-full preenchendo a coluna) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-payment" className="text-xs font-medium text-foreground">
                Meio de Pagamento
              </Label>
              <Select
                value={paymentMethod}
                onValueChange={(val) => setPaymentMethod(val as PaymentMethod)}
              >
                <SelectTrigger id="tx-payment" className="h-10 w-full">
                  <SelectValue placeholder="Meio de pagamento" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status da Transação (w-full preenchendo a coluna) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-status" className="text-xs font-medium text-foreground">
                Status da Transação
              </Label>
              <Select
                value={status}
                onValueChange={(val) => setStatus(val as TransactionStatus)}
              >
                <SelectTrigger id="tx-status" className="h-10 w-full">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Concluída / Paga</SelectItem>
                  <SelectItem value="pending">Pendente / Em Aberto</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Contato (Cliente / Fornecedor) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-contact" className="text-xs font-medium text-foreground">
                {type === "income" ? "Cliente / Pagador" : "Fornecedor / Favorecido"}
              </Label>
              <Input
                id="tx-contact"
                name="contact"
                placeholder="Ex: FinTech Brasil S.A."
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="h-10 w-full"
              />
            </div>

            {/* Data de Vencimento */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-due-date" className="text-xs font-medium text-foreground">
                Data de Vencimento (opcional)
              </Label>
              <Input
                id="tx-due-date"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-10 w-full"
              />
            </div>

            {/* Nº Nota Fiscal / Documento */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-doc" className="text-xs font-medium text-foreground">
                Nº Documento / NF
              </Label>
              <Input
                id="tx-doc"
                name="docNumber"
                placeholder="Ex: NF-2026/0491"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="h-10 w-full"
              />
            </div>

            {/* Observações de Conciliação */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-notes" className="text-xs font-medium text-foreground">
                Observações de Conciliação
              </Label>
              <Input
                id="tx-notes"
                name="notes"
                placeholder="Ex: Boleto emitido com 5% de desconto..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-10 w-full"
              />
            </div>
          </div>

          {/* Rodapé com espaçamento claro e tátil entre os botões */}
          <DialogFooter className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="px-4"
            >
              Cancelar
            </Button>
            <Button type="submit" className="px-5 font-semibold">
              {isEditing ? "Salvar Alterações" : "Cadastrar Transação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
