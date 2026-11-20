import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

/**
 * Tokens de cor via CSS variables oklch (`src/tokens-shadcn.css`).
 *
 * Cada cor é uma função para que os modificadores de opacidade do Tailwind
 * (`bg-primary/90`, `border-border/60`, etc.) continuem funcionando: o valor é
 * misturado com `transparent` em oklab. `color-mix()` é suportado desde
 * Chrome/Edge 111, Firefox 113 e Safari 16.2 (MDN, consulta 2026-11-20).
 * Não há mais `hsl()` nem canais HSL no projeto.
 */
function oklchColor(token: string): string {
  // Tailwind 3 aceita funções de cor em runtime, mas `Config` tipa apenas
  // string; o cast é necessário para manter o typecheck sem perder o alpha.
  return (({ opacityValue }: { opacityValue?: string }): string =>
    opacityValue === undefined
      ? `var(${token})`
      : `color-mix(in oklab, var(${token}) calc(${opacityValue} * 100%), transparent)`) as unknown as string;
}

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1200px",
      },
    },
    extend: {
      colors: {
        border: oklchColor("--border"),
        input: oklchColor("--input"),
        ring: oklchColor("--ring"),
        background: oklchColor("--background"),
        foreground: oklchColor("--foreground"),
        primary: {
          DEFAULT: oklchColor("--primary"),
          foreground: oklchColor("--primary-foreground"),
        },
        secondary: {
          DEFAULT: oklchColor("--secondary"),
          foreground: oklchColor("--secondary-foreground"),
        },
        destructive: {
          DEFAULT: oklchColor("--destructive"),
          foreground: oklchColor("--destructive-foreground"),
        },
        muted: {
          DEFAULT: oklchColor("--muted"),
          foreground: oklchColor("--muted-foreground"),
        },
        accent: {
          DEFAULT: oklchColor("--accent"),
          foreground: oklchColor("--accent-foreground"),
        },
        popover: {
          DEFAULT: oklchColor("--popover"),
          foreground: oklchColor("--popover-foreground"),
        },
        card: {
          DEFAULT: oklchColor("--card"),
          foreground: oklchColor("--card-foreground"),
        },
        chart: {
          1: oklchColor("--chart-1"),
          2: oklchColor("--chart-2"),
          3: oklchColor("--chart-3"),
          4: oklchColor("--chart-4"),
          5: oklchColor("--chart-5"),
        },
        sidebar: {
          DEFAULT: oklchColor("--sidebar"),
          foreground: oklchColor("--sidebar-foreground"),
          primary: oklchColor("--sidebar-primary"),
          "primary-foreground": oklchColor("--sidebar-primary-foreground"),
          accent: oklchColor("--sidebar-accent"),
          "accent-foreground": oklchColor("--sidebar-accent-foreground"),
          border: oklchColor("--sidebar-border"),
          ring: oklchColor("--sidebar-ring"),
        },
        // Cores de status dedicadas (ADR-06): theme-aware via classe .dark,
        // consumidas por bg-status-* / text-status-*-foreground no StatusBadge.
        "status-pendente": {
          DEFAULT: oklchColor("--status-pendente"),
          foreground: oklchColor("--status-pendente-fg"),
        },
        "status-confirmado": {
          DEFAULT: oklchColor("--status-confirmado"),
          foreground: oklchColor("--status-confirmado-fg"),
        },
        "status-em-atendimento": {
          DEFAULT: oklchColor("--status-em-atendimento"),
          foreground: oklchColor("--status-em-atendimento-fg"),
        },
        "status-concluido": {
          DEFAULT: oklchColor("--status-concluido"),
          foreground: oklchColor("--status-concluido-fg"),
        },
        "status-cancelado": {
          DEFAULT: oklchColor("--status-cancelado"),
          foreground: oklchColor("--status-cancelado-fg"),
        },
        "status-nao-compareceu": {
          DEFAULT: oklchColor("--status-nao-compareceu"),
          foreground: oklchColor("--status-nao-compareceu-fg"),
        },
        "status-sub-cancelado": {
          DEFAULT: oklchColor("--status-sub-cancelado"),
          foreground: oklchColor("--status-sub-cancelado-fg"),
        },
        // Cores de serviço derivadas do service_id (ADR-01): theme-aware.
        "service-1": oklchColor("--service-1"),
        "service-2": oklchColor("--service-2"),
        "service-3": oklchColor("--service-3"),
        "service-4": oklchColor("--service-4"),
        "service-5": oklchColor("--service-5"),
        "service-6": oklchColor("--service-6"),
        "service-7": oklchColor("--service-7"),
        "service-8": oklchColor("--service-8"),
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
