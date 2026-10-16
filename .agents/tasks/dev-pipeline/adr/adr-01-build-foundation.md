# ADR-01 — Fundação de build: Vite + React + TypeScript estrito, Tailwind, árvore de pastas

**Status:** proposto
**Escopo:** frontend (infra de build)
**Depende de:** nada — é o primeiro código da aplicação (greenfield).

## Contexto

O workdir é greenfield (só existem `.kiro/` e `.agents/`). Antes de qualquer tela, rota ou
design system, é preciso uma casca de projeto buildável e reprodutível, com as convenções
travadas desde o primeiro commit (PRD §1, §2.2; analysis-frontend §0). Esta ADR entrega só a
fundação de build — nenhum componente de UI, rota ou provider ainda, para manter o escopo
fechado e revisável sozinho. O build precisa concluir ao final desta ADR mesmo com uma app
mínima (um `App` trivial), garantindo CA-01 já aqui.

## Decisão

1. **Inicializar projeto Vite + React + TypeScript** na raiz do workdir (template
   `react-ts`), React 18 + Vite 5. Ponto de entrada `index.html` + `src/main.tsx` +
   `src/App.tsx` mínimo (um placeholder "Atlas Agenda" — será substituído na ADR-05).
2. **TypeScript estrito:** `tsconfig.json` com `"strict": true` e `"noImplicitAny": true`
   (sem `any` implícito). Habilitar `noUnusedLocals`/`noUnusedParameters` para disciplina.
3. **Tailwind CSS v3** instalado e configurado: `tailwind.config.ts` (com `darkMode: "class"`
   e `content` apontando para `index.html` e `src/**/*.{ts,tsx}`), `postcss.config.js`, e
   `src/index.css` com as diretivas `@tailwind base/components/utilities`. Os tokens de cor e
   o tema vêm na ADR-02 — aqui só a infra do Tailwind funcionando.
4. **Alias de import `@` → `src`** em `vite.config.ts` e `tsconfig.json` (padrão shadcn/ui,
   necessário para a ADR-02).
5. **Árvore de pastas** conforme `stack.md` (criar os diretórios, com `.gitkeep` onde ainda
   não houver arquivo): `src/{app,admin,marketing,auth,components,components/ui,lib,lib/validations,hooks,types}`
   e `supabase/{migrations,functions}`. As duas pastas de `supabase/` nascem **vazias**, só
   com `.gitkeep` (RF-SCAFF-03, CA-15 — nenhum `.sql` de schema).
6. **Gestão de segredos / env:**
   - `.gitignore` cobrindo `.env*` **exceto** `.env.example` (padrão: `.env*` + `!.env.example`),
     `node_modules`, `dist`.
   - `.env.example` versionado com **somente** as chaves `VITE_SUPABASE_URL` e
     `VITE_SUPABASE_ANON_KEY` sem valores reais, mais um **comentário explícito em pt-BR**
     avisando que tudo que começa com `VITE_` é embutido no bundle público — nunca colocar
     service role, chave Asaas ou token Evolution aqui (RNF-SCAFF-01, PRD §4 item 8).
7. **Versões fixadas:** todas as dependências em `package.json` sem range (`^`/`~`) — versões
   exatas — e `package-lock.json` committado (RF-SCAFF-10, CA-14). Instalar nesta ADR apenas
   o necessário para build (react, react-dom, vite, typescript, tailwindcss, postcss,
   autoprefixer, @vitejs/plugin-react, @types/*). As demais libs entram nas ADRs que as usam.
8. **Idioma base:** `index.html` com `<html lang="pt-BR">` e `<title>Atlas Agenda</title>`;
   nenhuma string "atlas-cobranca" em lugar nenhum (decisão do usuário, PRD §7 item 2). O
   `name` do `package.json` é `atlas-agenda`.

## Consequências

- Passa a existir uma SPA buildável e reprodutível; as ADRs seguintes só acrescentam camadas
  sobre esta base sem mexer na configuração de build.
- O alias `@` e `darkMode: "class"` já deixam o terreno pronto para shadcn/ui (ADR-02) e para
  o dark mode por padrão (ADR-02), sem retrabalho.
- Risco principal já endereçado na forma: `.env` ignorado e `.env.example` só com `VITE_*`
  comentado (a enforcement real de "só anon key" é de processo + `.gitignore`, não de runtime).

## Arquivos afetados

- `package.json`, `package-lock.json`
- `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- `tailwind.config.ts`, `postcss.config.js`
- `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `.gitignore`, `.env.example`
- `.gitkeep` em `src/{app,admin,marketing,auth,components,components/ui,lib,lib/validations,hooks,types}`
  e `supabase/{migrations,functions}`

## Critérios de aceite testáveis (desta ADR)

1. `npm install` conclui sem erro a partir do lockfile.
2. `npm run build` conclui **sem erro** e sem warning de tipo (TS estrito). (CA-01)
3. `npm run dev` sobe a SPA e a página mínima carrega sem erro no console. (CA-02)
4. Existem `src/{app,admin,marketing,auth,components,lib,hooks,types}` e
   `supabase/{migrations,functions}` vazias (só `.gitkeep`). (CA-12/RF-SCAFF-03)
5. `.gitignore` ignora `.env*` exceto `.env.example`; `.env.example` só tem chaves `VITE_*`
   sem valores e com o comentário de segurança em pt-BR. (CA-06/CA-13)
6. `package-lock.json` presente; nenhuma dependência com `^`/`~` no `package.json`. (CA-14)
7. Busca por `service_role`, `ASAAS`, `EVOLUTION` ou segredo privilegiado no código
   versionado não retorna nada. (CA-13)
8. `supabase/migrations/` não contém nenhum `.sql`. (CA-15)
9. Nenhuma ocorrência da string `atlas-cobranca` no repositório.

## Verificação

- `cd <workdir> && npm install && npm run build` → conclui limpo.
- `npm run dev` e abrir no navegador → sem erro no console (QA via Chrome DevTools pode adiar).
- Inspeção estática da árvore de pastas, `.gitignore`, `.env.example`, `package.json`/lockfile.
