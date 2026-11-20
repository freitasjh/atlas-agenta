import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/shadcn/ui/input"
import { cn } from "@/lib/cn"
import {
  SETTINGS_GROUPS,
  SETTINGS_NAV,
  type SettingsGroupId,
  type SettingsNavItem,
  type SettingsSectionId,
} from "./settings-types"

interface SettingsNavProps {
  active: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  // Atalho Ctrl/⌘ + K foca a busca de configurações
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return null
    return SETTINGS_NAV.filter((item) =>
      normalize([item.label, item.description, ...item.keywords].join(" ")).includes(q)
    )
  }, [query])

  const pick = (id: SettingsSectionId) => {
    onSelect(id)
    setQuery("")
  }

  const grouped = (Object.keys(SETTINGS_GROUPS) as SettingsGroupId[]).map((g) => ({
    id: g,
    items: SETTINGS_NAV.filter((i) => i.group === g),
  }))

  return (
    <nav aria-label="Seções de configurações" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <search className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar configuração…"
          aria-label="Buscar configuração"
          className="h-9 w-full pl-8 pr-12 text-xs"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border/80 bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">
          Ctrl K
        </kbd>
      </search>

      {results ? (
        <ul className="flex flex-col gap-1" aria-label="Resultados da busca">
          {results.length === 0 && (
            <li className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhuma configuração encontrada.
            </li>
          )}
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => pick(item.id)}
                className="flex w-full flex-col gap-0.5 rounded-lg border border-border/70 bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {SETTINGS_GROUPS[item.group]} <ChevronRight className="size-3" />
                </span>
                <span className="text-xs font-semibold text-foreground">{item.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">{item.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-none lg:flex-col lg:overflow-visible lg:pb-0">
          {grouped.map((g) => (
            <div key={g.id} className="flex shrink-0 flex-col gap-1 lg:shrink">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {SETTINGS_GROUPS[g.id]}
              </p>
              <ul className="flex gap-1 lg:flex-col">
                {g.items.map((item: SettingsNavItem) => {
                  const isActive = item.id === active
                  return (
                    <li key={item.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "relative flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        {item.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </nav>
  )
}

