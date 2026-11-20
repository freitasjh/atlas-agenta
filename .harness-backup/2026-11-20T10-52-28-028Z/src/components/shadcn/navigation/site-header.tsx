"use client"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/shadcn/ui/breadcrumb"
import { Separator } from "@/components/shadcn/ui/separator"
import { SidebarTrigger } from "@/components/shadcn/ui/sidebar"
import { CreateEntrySheet } from "@/components/shadcn/dashboard/create-entry-sheet"
import { ModeToggle } from "@/components/shadcn/navigation/mode-toggle"
import { NotificationCenter } from "@/components/shadcn/navigation/notification-center"

interface SiteHeaderProps {
  title?: string
}

export function SiteHeader({ title = "Visão geral" }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <span className="text-sm font-semibold tracking-tight text-foreground truncate max-w-[150px] sm:hidden">
          {title}
        </span>
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="#/shadcn">Plataforma</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-1.5">
          <CreateEntrySheet />
          <ModeToggle />
          <NotificationCenter />
        </div>
      </div>
    </header>
  )
}
