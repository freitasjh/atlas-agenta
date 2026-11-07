# Frontend Coding Standards (React)

Padrões de codificação para o frontend Atlas ECM (React 18+ + TypeScript + shadcn/ui + Zustand/Redux + Tailwind).

> Espelho React do padrão Vue/shadcn-vue. **Vuetify/PrimeVue proibidos** neste projeto — usar shadcn/ui (Radix UI + Tailwind CSS).

## Guia Canônico de Componentes UI
Para padrões de anatomia, acessibilidade (WCAG 2.1 AA), design tokens e templates de implementação de cada componente visual (Card, Input, Modal/Dialog, Drawer/Sheet, etc.), consulte:
- [`docs/FRONTEND_COMPONENTS_GUIDE.md`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/docs/FRONTEND_COMPONENTS_GUIDE.md)

## Stack definitiva

| Camada | Tecnologia | Obs |
|--------|------------|-----|
| Framework | React 18+ + TypeScript | Function components + Hooks |
| UI | shadcn/ui (baseado em Radix UI + Tailwind CSS) | Não usar Vuetify/PrimeVue |
| Estado | Zustand (ou Redux Toolkit) | Store por domínio |
| HTTP | axios + TanStack Query (`@tanstack/react-query`) opcional | `http` de `@/lib/axios` |
| Router | React Router v6 (`createBrowserRouter`) | lazy-loaded |
| i18n | react-i18next | `pt-BR` default |
| Form | react-hook-form + zod | schema-first |
| Icons | lucide-react | `Lucide*` |
| Build | Vite | alias `@` → `src/` |

## ESLint / Formatação

- `semi`: never (sem ponto e vírgula) — herdado, manter se já configurado; novo projeto usa Prettier + `eslint-config-prettier`
- `indent`: 2 espaços
- `comma-dangle`: always-multiline
- `camelcase`: error
- `@typescript-eslint/consistent-type-imports`: error
- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warn
- Ícones: `lucide-react` apenas, proibido `mdi-*` / `ri-*`
- `@core` / `@layouts` proibido — usar alias `@` simples

## Path Aliases (`vite.config.ts` + `tsconfig.json`)

| Alias | Path |
|-------|------|
| `@` | `src/` |
| `@images` | `src/assets/images/` |
| `@styles` | `src/assets/styles/` |

## Module Pattern

```
src/modules/{domain}/
  model/     → TS class/interface com defaults
  service/   → class-based com chamadas http
  store/     → Zustand store
  pages/     → layout + views
  components/→ componentes específicos do domínio
```

Para ECM, domínios: `tenant`, `identity`, `document`, `metadata`, `search`, `workflow`, `audit`.

### Model

```typescript
export interface Document {
  id: string | null
  title: string
}

export function createDocument(): Document {
  return { id: null, title: '' }
}
```

### Service

```typescript
import { http } from '@/lib/axios'
import type { Document } from '../model/document'

export class DocumentService {
  private endpoint = '/api/v1/documents'
  async list(params: DocumentFilter): Promise<Page<Document>> {
    const { data } = await http.get(`${this.endpoint}/filter`, { params })
    return data
  }
  async save(doc: Document): Promise<Document> {
    const { data } = doc.id
      ? await http.put(`${this.endpoint}/${doc.id}`, doc)
      : await http.post(this.endpoint, doc)
    return data
  }
}
```

### Store (Zustand — recomendado com shadcn/ui)

```typescript
import { create } from 'zustand'
import { DocumentService } from '../service/document.service'

interface DocumentState {
  page: Page<Document> | null
  findByFilter: (filter: DocumentFilter) => Promise<void>
}

export const useDocumentStore = create<DocumentState>((set) => ({
  page: null,
  async findByFilter(filter) {
    const page = await new DocumentService().list(filter)
    set({ page })
  },
}))
```

Compatível com Redux Toolkit se já em uso.

## Axios Config (`src/lib/axios.ts`)

- Instance `http` com `baseURL` via `VITE_API_URL` ou proxy `/api`
- Request interceptor: `Authorization: Bearer {token}` de `localStorage("accessToken")`
- Response interceptor: em 401, tenta refresh `/api/v1/auth/refresh`; falha → clear + redirect `/login`

## Router (`react-router-dom`)

- `createBrowserRouter` + `RouterProvider`
- Guard via loader/`ProtectedRoute`: sem token + rota protegida → `/login`
- Layouts: `layouts/DefaultLayout.tsx` (autenticado, sidebar) e `layouts/BlankLayout.tsx` (login/error)
- Lazy: `const List = lazy(() => import('@/pages/documents/List'))`

## Vite Proxy (dev)

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

Frontend usa `/api/v1/{resource}` → backend `/v1/{resource}`.

## Componentes (shadcn/ui)

- Gerar via CLI: `npx shadcn@latest add button card dialog input table badge`
- Usar componentes de `src/components/ui/*` (Button, Card, Dialog, Input, DataTable, etc.)
- Tailwind para layout; **não** usar componentes Vuetify/PrimeVue
- Function components + Hooks sempre; PascalCase (`<Button>`, `<DocumentForm>`)
- Estado de loading/empty/error obrigatório em listas; `Skeleton` para loading

## Composables (Hooks)

- `src/hooks/useLoader.ts` e `useToast.ts` (sonner / shadcn/ui toast)
- Erro: `toast.error(handlerError(error))`; sucesso: `toast.success("...")`

## Auto-imports (opcional)

- Se `unplugin-auto-import` ativo: hooks React auto-importados conforme config
- Caso contrário, imports explícitos

## Icons

- `lucide-react` — ex: `<Search className="h-4 w-4" />`
- Não usar `@iconify-json/ri` / `mdi` no Atlas ECM

## Dependências Principais (Atlas ECM)

| Pacote | Uso |
|--------|-----|
| react ^18.3 | Framework |
| shadcn/ui | UI (Radix + Tailwind) |
| tailwindcss | Estilo |
| zustand | Estado |
| react-router-dom ^6.26 | Roteamento |
| axios ^1.10 | HTTP |
| react-i18next | i18n |
| zod + react-hook-form | Forms/validação |
| lucide-react | Ícones |
| @tanstack/react-query | Cache server-state (opcional) |

## Build & Test

```bash
npm run dev           # Vite em :5173
npm run build         # tsc --noEmit && vite build
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # vitest run (happy-dom)
```

## Internationalization (MANDATORY)

Todo texto visível DEVE usar react-i18next. Proibido literal em template/script/placeholder/aria-label/tooltip.

1. Infra: `I18nextProvider`/`initReactI18next` em `src/i18n/index.ts`, `fallbackLng: 'pt-BR'`
2. Arquivos: `src/i18n/messages/pt-BR.ts` (completo) e `en-US.ts`
3. Chaves: dot-nested + prefixo módulo, camelCase. Ex: `document.actions.upload`, `document.status.APPROVED`
4. Uso: `const { t } = useTranslation()` em componentes; template via `t()`
5. Constantes `*_META`: guardar `labelKey`, resolver com `t(meta.labelKey)`
6. Default: PT-BR. Review flagra string fora de `<locale>.ts`