# Produto — Atlas Agenda (Micro-SaaS multi-tenant)

Fonte: `.kiro/steering/produto.md`. Regra descritiva.

## O que é
Plataforma web multi-tenant para prestadores de serviço/clínicas. Unifica agenda + régua WhatsApp + cobrança PIX. Objetivos: reduzir no-show (confirmação D-1), garantir recebimento (PIX pós-atendimento + baixa por webhook), custo infra ~zero (serverless/BaaS).

## Personas / RBAC
- Super Admin (fundadores): gerenciam tenants, assinaturas, instâncias WhatsApp, limites. Rotas `/admin`.
- Admin da Empresa: tudo dentro do tenant.
- Profissional: apenas própria agenda.
- Recepção: agendamentos de todos, sem dados financeiros sensíveis.

## Planos
Individual (1 prof, ≤150 agend./mês), Clínica (≤5 prof, ilimitado, msgs personalizadas, taxa reserva), Pro (>5 prof, relatórios, suporte prioritário). Status assinatura: trial, ativo, pendente, bloqueado, cancelado. `bloqueado` → tela de quitação; `cancelado` → arquiva e suspende disparos.

## Convenções
- UI em pt-BR. Nomes técnicos em inglês; conceitos de domínio manter convenção (`tenant_id`, `appointment`).
- Valores em BRL armazenados em centavos inteiros.
- Datas/horas em UTC; exibição no fuso do tenant (default America/Sao_Paulo).

## Fora de escopo MVP (Fase 1)
Autoagendamento público, taxa de reserva antecipada, painel métricas consolidadas = Fase 3. Não implementar sem pedido explícito.