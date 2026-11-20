"use client"

import { useMemo } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Wallet,
} from "lucide-react"

import { Card, CardContent } from "@/components/shadcn/ui/card"
import {
  type Transaction,
  formatCurrencyBRL,
} from "./transaction-types"

interface TransactionStatsProps {
  transactions: Transaction[]
}

export function TransactionStats({ transactions }: TransactionStatsProps) {
  const stats = useMemo(() => {
    let income = 0
    let expense = 0
    let pendingCount = 0
    let pendingAmount = 0

    for (const t of transactions) {
      if (t.status === "cancelled") continue

      if (t.type === "income") {
        income += t.amount
      } else if (t.type === "expense") {
        expense += t.amount
      }

      if (t.status === "pending") {
        pendingCount++
        pendingAmount += t.amount
      }
    }

    const balance = income - expense

    return {
      income,
      expense,
      balance,
      pendingCount,
      pendingAmount,
    }
  }, [transactions])

  return (
    <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
      {/* 1. Receitas */}
      <Card className="border-border/70 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total de Receitas
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <ArrowUpRight className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {formatCurrencyBRL(stats.income)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Entradas registradas no período
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2. Despesas */}
      <Card className="border-border/70 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total de Despesas
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <ArrowDownRight className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {formatCurrencyBRL(stats.expense)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Saídas operacionais e custos
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 3. Saldo Líquido */}
      <Card className="border-border/70 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Saldo Líquido
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wallet className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <div
              className={`text-2xl font-bold tracking-tight ${
                stats.balance >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {formatCurrencyBRL(stats.balance)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Receitas menos despesas realizadas
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 4. Pendências */}
      <Card className="border-border/70 shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Contas Pendentes
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {stats.pendingCount}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({formatCurrencyBRL(stats.pendingAmount)})
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Aguardando confirmação bancária
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

