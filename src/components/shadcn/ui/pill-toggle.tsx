"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"

export type PillToggleSize = "sm" | "md" | "lg"

export interface PillToggleOption<T extends string = string> {
  value: T
  label?: React.ReactNode
  icon?: React.ReactNode
  badge?: React.ReactNode
  disabled?: boolean
  title?: string
  activeClassName?: string
}

const pillToggleContainerVariants = cva(
  "inline-flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 shadow-2xs select-none transition-colors",
  {
    variants: {
      size: {
        sm: "h-7 sm:h-8 gap-0.5",
        md: "h-8 sm:h-9 gap-0.5",
        lg: "h-10 sm:h-11 p-1 rounded-xl gap-1",
      },
      fullWidth: {
        true: "w-full flex",
        false: "w-fit",
      },
    },
    defaultVariants: {
      size: "md",
      fullWidth: false,
    },
  }
)

const pillToggleItemVariants = cva(
  "inline-flex items-center justify-center font-medium transition-all shrink-0 cursor-pointer disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-md",
  {
    variants: {
      size: {
        sm: "h-6 sm:h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3.5",
        md: "h-7 sm:h-8 px-3 text-xs sm:text-sm font-semibold gap-1.5 [&_svg]:size-3.5 sm:[&_svg]:size-4",
        lg: "h-8 sm:h-9 px-4 text-sm font-semibold gap-2 [&_svg]:size-4 sm:[&_svg]:size-4.5",
      },
      active: {
        true: "bg-background text-foreground font-bold shadow-2xs ring-1 ring-border/50",
        false: "text-muted-foreground hover:text-foreground hover:bg-muted/60",
      },
      fullWidth: {
        true: "flex-1",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      active: false,
      fullWidth: false,
    },
  }
)

interface PillToggleContextValue {
  value?: string
  onChange?: (val: string) => void
  size: PillToggleSize
  fullWidth?: boolean
  disabled?: boolean
}

const PillToggleContext = React.createContext<PillToggleContextValue | null>(null)

export interface PillToggleProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">,
    VariantProps<typeof pillToggleContainerVariants> {
  value?: T
  defaultValue?: T
  onChange?: (value: T) => void
  options?: PillToggleOption<T>[]
  size?: PillToggleSize
  fullWidth?: boolean
  disabled?: boolean
  "aria-label"?: string
}

export function PillToggle<T extends string = string>({
  value: controlledValue,
  defaultValue,
  onChange,
  options,
  size = "md",
  fullWidth = false,
  disabled = false,
  className,
  children,
  "aria-label": ariaLabel = "Alternador de modo",
  ...props
}: PillToggleProps<T>) {
  const [internalValue, setInternalValue] = React.useState<T | undefined>(
    defaultValue ?? options?.[0]?.value
  )

  const isControlled = controlledValue !== undefined
  const activeValue = isControlled ? controlledValue : internalValue

  const handleSelect = (val: string) => {
    if (disabled) return
    if (!isControlled) {
      setInternalValue(val as T)
    }
    onChange?.(val as T)
  }

  const contextValue = React.useMemo(
    () => ({
      value: activeValue,
      onChange: handleSelect,
      size,
      fullWidth,
      disabled,
    }),
    [activeValue, size, fullWidth, disabled]
  )

  return (
    <PillToggleContext.Provider value={contextValue}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn(pillToggleContainerVariants({ size, fullWidth }), className)}
        {...props}
      >
        {options
          ? options.map((opt) => (
              <PillToggleItem
                key={opt.value}
                value={opt.value}
                icon={opt.icon}
                badge={opt.badge}
                activeClassName={opt.activeClassName}
                disabled={disabled || opt.disabled}
                title={opt.title}
              >
                {opt.label}
              </PillToggleItem>
            ))
          : children}
      </div>
    </PillToggleContext.Provider>
  )
}

export interface PillToggleItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
  icon?: React.ReactNode
  badge?: React.ReactNode
  activeClassName?: string
  children?: React.ReactNode
}

export function PillToggleItem({
  value,
  icon,
  badge,
  activeClassName,
  children,
  className,
  disabled: itemDisabled,
  onClick,
  ...props
}: PillToggleItemProps) {
  const context = React.useContext(PillToggleContext)
  if (!context) {
    throw new Error("PillToggleItem deve ser utilizado dentro de um <PillToggle>")
  }

  const isActive = context.value === value
  const isDisabled = context.disabled || itemDisabled

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      disabled={isDisabled}
      onClick={(e) => {
        onClick?.(e)
        if (!isDisabled) context.onChange?.(value)
      }}
      className={cn(
        pillToggleItemVariants({
          size: context.size,
          active: isActive,
          fullWidth: context.fullWidth,
        }),
        isActive && activeClassName,
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      {children && <span className="truncate">{children}</span>}
      {badge !== undefined && badge !== null && (
        <span
          className={cn(
            "ml-1 font-mono text-[10px] px-1.5 py-0.2 rounded-full",
            isActive
              ? "bg-muted text-foreground font-bold"
              : "bg-muted/70 text-muted-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

