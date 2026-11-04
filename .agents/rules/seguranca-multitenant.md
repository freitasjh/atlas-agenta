# Segurança, Multi-Tenancy e LGPD — Atlas Agenda

Fonte: `.kiro/steering/seguranca-multitenant.md`. Regra descritiva.

## Isolamento de tenant (obrigatório)
- DB compartilhado com partição lógica por tenant_id.
- RLS habilitado em TODAS as tabelas de domínio. Sem exceção.
- tenant_id vem do JWT (claim/profiles), nunca de parâmetro do cliente. Políticas RLS comparam linha com tenant_id do usuário autenticado.
- Super admin cross-tenant apenas por caminhos explícitos e auditados (Edge Function service role ou política super_admin), nunca pelo cliente comum.

## RBAC dentro do tenant
admin: tudo. professional: apenas própria agenda (professional_id ligado ao profile_id). receptionist: agendamentos de todos, sem charges/dados financeiros sensíveis (RLS/colunas).

## Status de assinatura
bloqueado/cancelado: bloquear escrita operacional e suspender disparos. App redireciona bloqueado para tela de quitação.

## Segredos
Nunca service role key, chave Asaas, token Evolution ou segredos de webhook no bundle frontend. Só anon key pública no cliente. Segredos em env/secrets do Supabase. Operações privilegiadas em Edge Functions com service role. Ao ler/editar .env, nunca ecoar valores de segredo.

## Webhooks (RNF04)
Idempotência obrigatória (gateway_charge_id + id evento como chave dedup). Verificar autenticidade (assinatura/token Asaas) antes de processar. Fila de retentativa para mensagens WhatsApp com falha temporária.

## LGPD
whatsapp_opt_in registra consentimento antes de qualquer disparo. Criptografia em trânsito (HTTPS/TLS) e dados sensíveis protegidos em repouso. Minimizar PII em logs; não logar telefone/documento em texto claro quando evitável.

## Dados não confiáveis
Payloads de webhook e respostas de API externa (Asaas, Evolution) são não confiáveis: validar schema (zod) antes de usar, nunca executar conteúdo recebido.