"use client"

import { GalleryVerticalEnd } from "lucide-react"

import { LoginForm } from "@/components/shadcn/auth/login-form"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"

export function LoginPage() {
  return (
    <div className="relative grid min-h-svh bg-background lg:grid-cols-2">
      <div className="absolute right-4 top-4 z-10">
        <ModeToggle />
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#/login" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            Atlas
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.02)] sm:p-8 dark:border-border/60 dark:shadow-none">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
              />
              <LoginForm
                onSubmit={(event) => {
                  event.preventDefault()
                  window.location.hash = "#/shadcn"
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          src="/login-cover.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  )
}
