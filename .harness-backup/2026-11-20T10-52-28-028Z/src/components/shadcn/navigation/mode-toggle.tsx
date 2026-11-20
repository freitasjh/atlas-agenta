"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"

const STORAGE_KEY = "harness-color-mode"

function readDark(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "dark") return true
    if (saved === "light") return false
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

export function ModeToggle() {
  const [dark, setDark] = useState(readDark)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  function toggle(): void {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light")
    } catch {
      /* armazenamento indisponível: segue sem persistência */
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      title="Modo claro/escuro"
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
