import { useState, useMemo } from "react"
import { Building2, Landmark, Receipt } from "lucide-react"
import { PillToggle } from "@/components/shadcn/ui/pill-toggle"
import { AccountSelectorBar } from "./account-selector-bar"
import { AccountSummaryHeader } from "./account-summary-header"
import { BankAccountsGrid } from "./bank-accounts-grid"
import { BankAccountStatementTable } from "./bank-account-statement-table"
import { NewBankAccountModal } from "./new-bank-account-modal"
import { InternalTransferModal } from "./internal-transfer-modal"
import { ImportOFXModal } from "./import-ofx-modal"
import {
  MOCK_BANK_ACCOUNTS,
  MOCK_BANK_TRANSACTIONS,
  type BankAccount,
  type BankStatementTransaction,
  type TreasuryMetrics,
} from "./bank-accounts-types"
import { toast } from "sonner"

export interface BankAccountsViewProps {
  initialAccounts?: BankAccount[]
  initialTransactions?: BankStatementTransaction[]
  initialViewMode?: "statements" | "grid"
}

export function BankAccountsView({
  initialAccounts = MOCK_BANK_ACCOUNTS,
  initialTransactions = MOCK_BANK_TRANSACTIONS,
  initialViewMode = "statements",
}: BankAccountsViewProps) {
  const [accounts, setAccounts] = useState<BankAccount[]>(initialAccounts)
  const [transactions, setTransactions] = useState<BankStatementTransaction[]>(initialTransactions)
  const [selectedAccountId, setSelectedAccountId] = useState<string>("")
  const [viewMode, setViewMode] = useState<"statements" | "grid">(initialViewMode)

  // Modais
  const [newAccountModalOpen, setNewAccountModalOpen] = useState(false)
  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [importOFXModalOpen, setImportOFXModalOpen] = useState(false)
  const [transferSourceId, setTransferSourceId] = useState<string>("")
  const [ofxTargetId, setOfxTargetId] = useState<string>("")

  // Conta Ativa
  const activeAccount = useMemo(() => {
    if (!selectedAccountId) return null
    return accounts.find((a) => a.id === selectedAccountId) || null
  }, [accounts, selectedAccountId])

  // Métricas de Tesouraria
  const metrics: TreasuryMetrics = useMemo(() => {
    const totalConsolidated = accounts.reduce((acc, a) => acc + a.currentBalance, 0)
    const totalBlocked = accounts.reduce((acc, a) => acc + a.blockedBalance, 0)
    const totalAvailable = totalConsolidated - totalBlocked

    return {
      totalConsolidatedBalance: totalConsolidated,
      totalAvailableBalance: totalAvailable,
      totalBlockedBalance: totalBlocked,
      projectedInflow15Days: 84250.0,
      projectedOutflow15Days: 42100.0,
      monthYieldCDI: 3840.5,
      yieldPercentageCDI: 1.04,
    }
  }, [accounts])

  // Adicionar Nova Conta
  const handleAddAccount = (newAcc: BankAccount) => {
    setAccounts([newAcc, ...accounts])
    setSelectedAccountId(newAcc.id)
  }

  // Executar Transferência Interna
  const handleExecuteTransfer = (
    sourceId: string,
    targetId: string,
    amount: number,
    description: string
  ) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id === sourceId) {
          return {
            ...acc,
            currentBalance: acc.currentBalance - amount,
            reconciledBalance: acc.reconciledBalance - amount,
          }
        }
        if (acc.id === targetId) {
          return {
            ...acc,
            currentBalance: acc.currentBalance + amount,
            reconciledBalance: acc.reconciledBalance + amount,
          }
        }
        return acc
      })
    )

    const now = new Date().toLocaleDateString("pt-BR")
    const srcAcc = accounts.find((a) => a.id === sourceId)
    const tgtAcc = accounts.find((a) => a.id === targetId)

    const debitTx: BankStatementTransaction = {
      id: `tx-trf-out-${Date.now()}`,
      accountId: sourceId,
      date: now,
      description: `${description} para ${tgtAcc?.nickname || "Conta Destino"}`,
      category: "Transferência Entre Contas",
      counterparty: tgtAcc?.nickname,
      amount: -amount,
      type: "transfer_out",
      reconciliationStatus: "reconciled",
      documentNumber: `TRF-${Math.floor(Math.random() * 90000) + 10000}`,
      hasAttachment: false,
    }

    const creditTx: BankStatementTransaction = {
      id: `tx-trf-in-${Date.now()}`,
      accountId: targetId,
      date: now,
      description: `Aporte recebido de ${srcAcc?.nickname || "Conta Origem"}`,
      category: "Transferência Entre Contas",
      counterparty: srcAcc?.nickname,
      amount: amount,
      type: "transfer_in",
      reconciliationStatus: "reconciled",
      documentNumber: `TRF-${Math.floor(Math.random() * 90000) + 10000}`,
      hasAttachment: false,
    }

    setTransactions([debitTx, creditTx, ...transactions])
  }

  // Conciliar Lançamento
  const handleReconcileTx = (txId: string) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === txId ? { ...tx, reconciliationStatus: "reconciled" as const } : tx
      )
    )
  }

  // Importar OFX concluído
  const handleImportOFXSuccess = (targetAccountId: string, count: number) => {
    const acc = accounts.find((a) => a.id === targetAccountId)
    const newTxs: BankStatementTransaction[] = []
    const now = new Date().toLocaleDateString("pt-BR")

    for (let i = 0; i < count; i++) {
      const isCredit = Math.random() > 0.4
      const amount = (Math.floor(Math.random() * 500) + 50) * (isCredit ? 1 : -1)
      newTxs.push({
        id: `tx-ofx-${Date.now()}-${i}`,
        accountId: targetAccountId,
        date: now,
        description: isCredit ? `Recebimento OFX #${i + 1}` : `Pagamento Débito OFX #${i + 1}`,
        category: isCredit ? "Receitas Operacionais" : "Despesas Gerais",
        amount,
        type: isCredit ? "credit" : "debit",
        reconciliationStatus: "reconciled",
        documentNumber: `OFX-${Math.floor(Math.random() * 99999)}`,
        hasAttachment: false,
      })
    }

    setTransactions([...newTxs, ...transactions])
    if (acc) {
      setSelectedAccountId(acc.id)
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4 lg:px-6 w-full pb-8">
      {/* Cabeçalho da Página com Alternador de Visão (Padrão idêntico a Cartões) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl flex items-center gap-2">
            <Landmark className="h-6 w-6 text-primary" />
            Contas Bancárias & Tesouraria
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gerencie saldos correntes, investimentos, conciliação e Open Finance em um único painel.
          </p>
        </div>

        {/* Alternador de Modo: Extrato da Conta vs Visão Geral de Todas as Contas */}
        <PillToggle
          value={viewMode}
          onChange={(val) => setViewMode(val as "statements" | "grid")}
          size="sm"
          className="self-start sm:self-auto"
          aria-label="Modo de visualização das contas bancárias"
          options={[
            {
              value: "statements",
              label: "Extrato & Conciliação",
              icon: <Receipt className="size-3.5" />,
            },
            {
              value: "grid",
              label: "Carteira de Contas",
              icon: <Building2 className="size-3.5" />,
            },
          ]}
        />
      </div>

      {/* Barra de Seleção Rápida de Contas (Chips Horizontais) */}
      <AccountSelectorBar
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        totalConsolidatedBalance={metrics.totalConsolidatedBalance}
        onSelectAccount={(accId) => setSelectedAccountId(accId)}
        onAddNewAccount={() => setNewAccountModalOpen(true)}
      />

      {/* Conteúdo Conforme o Modo Selecionado */}
      {viewMode === "statements" ? (
        <div className="space-y-4">
          {/* Header Compacto da Conta Selecionada ou Consolidado */}
          <AccountSummaryHeader
            account={activeAccount}
            metrics={metrics}
            onOpenTransfer={() => {
              setTransferSourceId(selectedAccountId || accounts[0]?.id || "")
              setTransferModalOpen(true)
            }}
            onOpenImportOFX={() => {
              setOfxTargetId(selectedAccountId || accounts[0]?.id || "")
              setImportOFXModalOpen(true)
            }}
            onSyncAccount={() => {
              setAccounts((prev) =>
                prev.map((a) =>
                  !selectedAccountId || a.id === selectedAccountId
                    ? { ...a, lastSyncAt: "Sincronizado agora" }
                    : a
                )
              )}
            }
          />

          {/* Tabela de Extrato e Conciliação */}
          <BankAccountStatementTable
            account={activeAccount}
            transactions={transactions}
            onReconcileTransaction={handleReconcileTx}
            onExportStatement={(format) => {
              toast.success(`Exportação do extrato em .${format.toUpperCase()} iniciada!`)
            }}
          />
        </div>
      ) : (
        /* Visão em Grade Completa (Modo Carteira de Contas) */
        <div className="space-y-4">
          <BankAccountsGrid
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={(acc) => {
              setSelectedAccountId(acc.id)
              setViewMode("statements") // Volta para o extrato da conta selecionada
            }}
            onOpenNewAccount={() => setNewAccountModalOpen(true)}
            onTransferFrom={(acc) => {
              setTransferSourceId(acc.id)
              setTransferModalOpen(true)
            }}
            onImportOFX={(acc) => {
              setOfxTargetId(acc.id)
              setImportOFXModalOpen(true)
            }}
          />
        </div>
      )}

      {/* Modais Integrados */}
      <NewBankAccountModal
        open={newAccountModalOpen}
        onOpenChange={setNewAccountModalOpen}
        onAddAccount={handleAddAccount}
      />

      <InternalTransferModal
        open={transferModalOpen}
        onOpenChange={setTransferModalOpen}
        accounts={accounts}
        initialSourceAccountId={transferSourceId}
        onExecuteTransfer={handleExecuteTransfer}
      />

      <ImportOFXModal
        open={importOFXModalOpen}
        onOpenChange={setImportOFXModalOpen}
        accounts={accounts}
        initialAccountId={ofxTargetId}
        onImportSuccess={handleImportOFXSuccess}
      />
    </div>
  )
}
