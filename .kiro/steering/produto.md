---
inclusion: always
---

# Produto: Atlas Agenda — Micro-SaaS de Agenda & Cobrança via WhatsApp

## O que é

Plataforma web Micro-SaaS **multi-empresa (multi-tenant)** para prestadores de serviço e
clínicas (estética, saúde, psicologia, barbearias, estúdios, consultórios). Unifica gestão de
agendamentos com uma régua de comunicação e cobrança automatizada via **WhatsApp** e **PIX**.

Objetivos de negócio centrais:

- **Reduzir no-show** com confirmações interativas automáticas 24h antes (D-1).
- **Garantir recebimento** com cobrança PIX pós-atendimento e baixa automática por webhook.
- **Custo de infra próximo de zero** com arquitetura serverless/BaaS.

## Personas e papéis (RBAC)

- **Super Admin** — fundadores da plataforma. Gerenciam empresas assinantes, assinaturas,
  instâncias de WhatsApp e limites de uso. Rotas em `/admin`.
- **Admin da Empresa** — proprietário/gerente do tenant. Configura serviços, preços, equipe,
  faturamento. Acesso total dentro do tenant.
- **Profissional** — vê e gerencia apenas a própria agenda.
- **Recepção/Secretária** — gerencia agendamentos de todos os profissionais, **sem acesso a
  dados financeiros sensíveis**.

## Planos e limites

- **Individual/Autônomo:** 1 profissional, até 150 agendamentos/mês, régua padrão.
- **Clínica/Equipe:** até 5 profissionais, agendamentos ilimitados, mensagens personalizadas,
  taxa de reserva configurável.
- **Pro/Multi-Profissionais:** >5 profissionais (adicional por extra), relatórios, suporte
  prioritário.

Status de assinatura do tenant: `trial`, `ativo`, `pendente`, `bloqueado`, `cancelado`.
Regras de acesso devem respeitar o status (ex.: `bloqueado` redireciona para tela de quitação;
`cancelado` arquiva dados e suspende disparos).

## Convenções de linguagem

- **Idioma do produto e da UI: português do Brasil.** Textos, labels, mensagens de erro e
  documentação voltada ao usuário em pt-BR.
- Nomes de código (variáveis, funções, tabelas) em inglês quando forem técnicos genéricos;
  conceitos de domínio podem usar o termo de negócio consolidado (ex.: `tenant_id`,
  `agendamento`/`appointment` — escolha uma convenção e mantenha consistente, ver domínio.md).
- Valores monetários sempre em BRL (R$), armazenados em centavos (inteiro) para evitar erro
  de ponto flutuante.
- Datas/horas armazenadas em UTC; exibição no fuso do tenant (padrão `America/Sao_Paulo`).

## Fora de escopo no MVP (Fase 1)

Link público de autoagendamento, taxa de reserva obrigatória antecipada e painel de métricas
consolidadas são **Fase 3**. Não implementar no MVP salvo pedido explícito.
