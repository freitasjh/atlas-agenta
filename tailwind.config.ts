import type { Config } from "tailwindcss";

// Tokens de cor e tema completo entram na ADR-02. Aqui só a infra do Tailwind.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
