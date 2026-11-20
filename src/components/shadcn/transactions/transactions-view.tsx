"use client"

import { useState } from "react"
import { toast } from "sonner"

import {
  type Transaction,
  type TransactionStatus,
  INITIAL_TRANSACTIONS,
} from "./transaction-types"
import { TransactionStats } from "./transaction-stats"
import { TransactionTable } from "./transaction-table"
import { TransactionDialog } from "./transaction-dialog"
import { TransactionDetailDialog } from "./transaction-detail-dialog"

interface TransactionsViewProps {
  initialTransactions?: Transaction[]
  className?: string
}

export function TransactionsView({
  initialTransactions = INITIAL_TRANSACTIONS,
  className = "",
}: TransactionsViewProps) {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)

  // Abrir modal de criação
  function handleOpenCreate() {
    setEditingTransaction(null)
    setIsDialogOpen(true)
  }

  // Abrir modal de edição
  function handleOpenEdit(tx: Transaction) {
    setEditingTransaction(tx)
    setIsDialogOpen(true)
  }

  // Abrir modal de detalhes
  function handleOpenDetail(tx: Transaction) {
    setSelectedTransaction(tx)
    setIsDetailOpen(true)
  }

  // Salvar (criar ou atualizar)
  function handleSaveTransaction(
    data: Omit<Transaction, "id" | "createdAt"> & { id?: string }
  ) {
    if (data.id) {
      // Atualizar existente
      setTransactions((prev) =>
        prev.map((t) => (t.id === data.id ? { ...t, ...data } : t))
      )
    } else {
      // Criar nova
      const newTx: Transaction = {
        ...data,
        id: `tx-${Date.now().toString().slice(-5)}`,
        createdAt: new Date().toISOString(),
      }
      setTransactions((prev) => [newTx, ...prev])
    }
  }

  // Excluir transação
  function handleDeleteTransaction(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id))
    toast.success("Transação excluída com sucesso.")
  }

  // Alternar status (ex: marcar pendente como concluída)
  function handleToggleStatus(id: string, newStatus: TransactionStatus) {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
    )
    toast.success(
      newStatus === "completed"
        ? "Transação marcada como concluída/paga!"
        : "Status da transação alterado."
    )
  }

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col gap-1 px-4 lg:px-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Gestão & Cadastro de Transações
        </h1>
        <p className="text-xs text-muted-foreground">
          Acompanhe o fluxo de caixa, registre entradas e saídas operacionais e gerencie a conciliação bancária.
        </p>
      </div>

      {/* Cards de Métricas / Resumo */}
      <TransactionStats transactions={transactions} />

      {/* Tabela com Filtros e Ações */}
      <TransactionTable
        transactions={transactions}
        onNewTransaction={handleOpenCreate}
        onSelectTransaction={handleOpenDetail}
        onEditTransaction={handleOpenEdit}
        onDeleteTransaction={handleDeleteTransaction}
        onToggleStatus={handleToggleStatus}
      />

      {/* Modal de Cadastro e Edição */}
      <TransactionDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSave={handleSaveTransaction}
        transactionToEdit={editingTransaction}
      />

      {/* Modal de Detalhes / Comprovante */}
      <TransactionDetailDialog
        transaction={selectedTransaction}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        onEdit={handleOpenEdit}
        onDelete={handleDeleteTransaction}
      />
    </div>
  )
}

