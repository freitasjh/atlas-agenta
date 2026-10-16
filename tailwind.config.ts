import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Tokens de cor via CSS variables HSL (ver src/index.css). Padrão shadcn/ui.
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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Cores de status dedicadas (ADR-06): theme-aware via classe .dark,
        // consumidas por bg-status-* / text-status-*-foreground no StatusBadge.
        "status-pendente": {
          DEFAULT: "hsl(var(--status-pendente))",
          foreground: "hsl(var(--status-pendente-fg))",
        },
        "status-confirmado": {
          DEFAULT: "hsl(var(--status-confirmado))",
          foreground: "hsl(var(--status-confirmado-fg))",
        },
        "status-em-atendimento": {
          DEFAULT: "hsl(var(--status-em-atendimento))",
          foreground: "hsl(var(--status-em-atendimento-fg))",
        },
        "status-concluido": {
          DEFAULT: "hsl(var(--status-concluido))",
          foreground: "hsl(var(--status-concluido-fg))",
        },
        "status-cancelado": {
          DEFAULT: "hsl(var(--status-cancelado))",
          foreground: "hsl(var(--status-cancelado-fg))",
        },
        "status-nao-compareceu": {
          DEFAULT: "hsl(var(--status-nao-compareceu))",
          foreground: "hsl(var(--status-nao-compareceu-fg))",
        },
        "status-sub-cancelado": {
          DEFAULT: "hsl(var(--status-sub-cancelado))",
          foreground: "hsl(var(--status-sub-cancelado-fg))",
        },
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
