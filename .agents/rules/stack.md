# Stack Tecnológica e Decisões de Arquitetura — Atlas Agenda

Fonte: `.kiro/steering/stack.md`. Regra descritiva.

## Frontend
React + Vite (SPA), TypeScript. Tailwind + shadcn/ui. React Router. TanStack Query para estado de servidor; react-hook-form + zod para forms. Mobile-first, 100% responsivo (RNF02). Carregamento agenda <1,5s (RNF01).

## Backend / BaaS
Supabase: PostgreSQL + Auth + RLS + Edge Functions. Migrations versionadas em supabase/migrations. Nunca alterar schema só pela UI do Supabase sem gerar migration.

## Integrações
Gateway pagamento: Asaas (PIX dinâmico QR+copia e cola + webhooks). WhatsApp: Evolution API (instância VPS, pareamento por QR, múltiplos clientes).

## Hospedagem
Frontend em Vercel ou Cloudflare Pages (deploy contínuo via Git, CDN). Backend serverless no Supabase.

## Estrutura repo (single codebase)
src/app (rotas tenant), src/admin (super admin), src/marketing (públicas), src/auth, src/components, src/lib, src/hooks, src/types. supabase/migrations, supabase/functions.

## Versionamento dependências
Fixar versões (exatas/lockfile). Preferir pacotes conhecidos. Nunca commitar segredos; chaves em env/secrets.
