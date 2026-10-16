---
name: ui-frontend
description: Construir a UI do Atlas Agenda com React + Vite + TypeScript + Tailwind + shadcn/ui - estrutura de rotas (marketing/auth/app/admin), guards de RBAC e status de assinatura, dados com TanStack Query e formulários com react-hook-form + zod. Use ao criar telas, componentes ou rotas do frontend.
---

# UI / Frontend (React + Vite + Tailwind + shadcn/ui)

Guia para montar as telas respeitando a stack, o RBAC e o mobile-first (RNF01/RNF02).

## Estrutura de rotas

```
/                    marketing  (landing)          público
/precos /termos      marketing                     público
/login /cadastro /recuperar-senha   auth           público
/app/*  (ou /dashboard/*)   tenant                 autenticado (admin|professional|receptionist)
/admin/*             super admin                    autenticado (super_admin)
```

Organização em `src/marketing`, `src/auth`, `src/app`, `src/admin`, com UI compartilhada em
`src/components`.

## Guards de acesso

- **Autenticação:** rota de app/admin exige sessão Supabase; sem sessão → `/login`.
- **RBAC:** derivar `role` do `profiles`. Esconder/negar telas fora do papel:
  - `professional`: só a própria agenda.
  - `receptionist`: agenda de todos, **sem** telas financeiras (cobranças).
  - `admin`: tudo do tenant. `super_admin`: só `/admin`.
- **Status de assinatura:** ler `tenants.subscription_status`.
  - `bloqueado` → redirecionar para tela de quitação.
  - `cancelado` → acesso suspenso.
  - Guard central (layout do `/app`) que intercepta antes de renderizar módulos.

## Dados e formulários

- Dados de servidor: **TanStack Query** (`useQuery`/`useMutation`), com invalidação de cache
  após mutação. Nada de `fetch` solto em `useEffect`.
- Cliente Supabase do browser com **anon key**; RLS garante o isolamento (não filtrar por
  `tenant_id` manualmente para "contornar" nada).
- Formulários: **react-hook-form** + resolver **zod**. Mensagens de validação em pt-BR.

## Design system / estilo

- **shadcn/ui** + Tailwind. Reaproveitar componentes existentes em `src/components/ui`;
  não recriar primitivos.
- **Mobile-first:** estilizar o breakpoint pequeno primeiro, depois `sm/md/lg`. A equipe usa no
  celular (RNF02), sem app nativo.
- Agenda deve carregar < 1,5s (RNF01): paginar/virtualizar listas grandes, evitar waterfalls de
  request, usar skeletons.

## Acessibilidade (obrigatório)

- `label` associado a cada input, foco visível, contraste adequado, navegação por teclado,
  `aria-*` onde necessário. Componentes shadcn/ui já ajudam — não quebrar isso.

## Padrões de tela do MVP

- **Agenda:** visão por dia/semana/profissional, criar/editar/cancelar, badges de status.
- **Clientes:** CRUD + `whatsapp_opt_in`.
- **Serviços:** nome, duração, preço (exibir em R$, guardar em centavos), profissionais.
- **Cobranças:** lista de `charges` (só admin), status, QR/copia-e-cola.
- **Config WhatsApp:** QR de pareamento + estado da conexão.
- **Admin (/admin):** lista de empresas, status de assinatura, instâncias, limites de uso.

## Dinheiro e datas na UI

- Exibir valores em `R$` formatando a partir de `*_cents` (dividir por 100, `Intl.NumberFormat`
  `pt-BR`).
- Exibir datas no fuso do tenant; converter de UTC na borda de apresentação.

## Checklist

- [ ] Rota no grupo certo (marketing/auth/app/admin).
- [ ] Guard de auth + RBAC + status de assinatura aplicado.
- [ ] Dados via TanStack Query; formulário via react-hook-form + zod.
- [ ] Mobile-first e acessível.
- [ ] Textos em pt-BR; dinheiro a partir de centavos; datas no fuso do tenant.
