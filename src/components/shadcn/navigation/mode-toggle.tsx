"use client"

import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import { useTheme } from "@/components/ThemeProvider"

/**
 * Alternador de tema do template, integrado ao ThemeProvider da aplicação.
 * Antes usava uma chave própria (`harness-color-mode`) e competia com o
 * provider pelo `<html class="dark">`; agora há uma única fonte de verdade.
 */
export function ModeToggle() {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      title="Modo claro/escuro"
      className="min-h-11 min-w-11"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
