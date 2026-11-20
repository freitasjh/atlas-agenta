import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react"

import { Badge } from "@/components/shadcn/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card"
import { cn } from "@/lib/cn"

type Stat = {
  label: string
  value: string
  badge: string
  direction: "up" | "down"
  trend: string
  note: string
  nowrap?: boolean
}

const stats: Stat[] = [
  {
    label: "Receita operacional",
    value: "R$ 1,25M",
    badge: "+12,5%",
    direction: "up",
    trend: "Em alta neste mês",
    note: "Receita dos últimos 6 meses",
    nowrap: true,
  },
  {
    label: "Novos clientes",
    value: "1.234",
    badge: "-20%",
    direction: "down",
    trend: "Queda de 20% no período",
    note: "Aquisição pede atenção",
  },
  {
    label: "Contas ativas",
    value: "45.678",
    badge: "+12,5%",
    direction: "up",
    trend: "Retenção forte de usuários",
    note: "Engajamento acima da meta",
  },
  {
    label: "Taxa de crescimento",
    value: "4,5%",
    badge: "+4,5%",
    direction: "up",
    trend: "Performance em alta constante",
    note: "Dentro das projeções",
  },
]

function StatCard({ stat }: { stat: Stat }) {
  const TrendIcon = stat.direction === "up" ? IconTrendingUp : IconTrendingDown
  const isUp = stat.direction === "up"

  return (
    <div className="rounded-[calc(var(--radius)+0.375rem)] border border-border/50 bg-muted/30 p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] dark:border-border/40 dark:bg-muted/15">
      <Card className="relative h-full gap-4 overflow-hidden rounded-[var(--radius)] border-border/60 bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.03),0_6px_16px_0_rgba(0,0,0,0.02)] transition-shadow hover:shadow-[0_2px_6px_0_rgba(0,0,0,0.05),0_10px_24px_0_rgba(0,0,0,0.04)] dark:border-border/50 dark:shadow-none dark:hover:border-border/80">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
        />
        <CardHeader>
          <CardDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">
            {stat.label}
          </CardDescription>
          <CardTitle
            className={cn(
              "text-2xl font-semibold tracking-tight tabular-nums @[250px]/card:text-3xl",
              stat.nowrap && "whitespace-nowrap @[250px]/card:text-2xl"
            )}
          >
            {stat.value}
          </CardTitle>
          <CardAction>
            <Badge
              variant="outline"
              className={cn(
                "gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
                isUp
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300"
              )}
            >
              <TrendIcon className="size-3.5" />
              {stat.badge}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex items-center gap-1.5 font-medium text-foreground/90">
            {stat.trend}
          </div>
          <div className="text-xs text-muted-foreground">{stat.note}</div>
        </CardFooter>
      </Card>
    </div>
  )
}

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </div>
  )
}
