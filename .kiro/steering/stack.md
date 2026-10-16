---
inclusion: always
---

# Stack Tecnológica e Decisões de Arquitetura

Decisões padrão deste projeto (confirmadas como ponto de partida; mudar só com pedido explícito
do usuário). A spec lista alternativas; aqui ficam as escolhas efetivas.

## Frontend

- **React + Vite** (SPA), **TypeScript**.
- **Tailwind CSS** + **shadcn/ui** para o design system.
- **React Router** para roteamento.
- Estado de servidor com **TanStack Query**; formulários com **react-hook-form** + **zod**.
- **Mobile-first** e 100% responsivo (RNF02). Carregamento da agenda < 1,5s (RNF01).

## Backend / BaaS

- **Supabase**: PostgreSQL + Auth + Row Level Security (RLS) + Edge Functions.
- Justificativa: RLS é natural para multi-tenant por `tenant_id`; Edge Functions cobrem
  webhooks de pagamento e jobs de disparo.
- Migrations versionadas em `supabase/migrations`. Nunca alterar schema só pela UI do Supabase
  sem gerar migration correspondente.

## Integrações

- **Gateway de pagamento: Asaas** — PIX dinâmico (QR Code + copia e cola) e webhooks.
- **Motor de WhatsApp: Evolution API** (instância em VPS) — pareamento por QR Code,
  múltiplos clientes por instância.

## Hospedagem / Deploy

- Frontend em **Vercel** ou **Cloudflare Pages** (deploy contínuo via Git, CDN global).
- Backend serverless no Supabase (sem servidores dedicados a gerenciar).

## Estrutura de repositório (single codebase)

```
atlas-agenda/
  src/
    app/          # rotas do tenant (/dashboard|/app): agenda, clientes, cobranças, config
    admin/        # rotas do super admin (/admin)
    marketing/    # rotas públicas: /, /precos, /termos
    auth/         # /login, /cadastro, /recuperar-senha
    components/   # UI compartilhada (shadcn/ui)
    lib/          # clientes (supabase, asaas, evolution), utils, validações zod
    hooks/        # hooks de dados (TanStack Query)
    types/        # tipos de domínio e DTOs
  supabase/
    migrations/   # SQL versionado
    functions/    # Edge Functions (webhooks, disparos)
```

## Regras de versionamento de dependências

- Fixar versões (exatas ou com lockfile). Preferir pacotes conhecidos e mantidos.
- Nunca commitar segredos. Chaves de API (Asaas, Evolution, Supabase service role) vivem em
  variáveis de ambiente / secrets, nunca no código ou no cliente.
