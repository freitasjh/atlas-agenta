---
inclusion: always
---

# Segurança, Multi-Tenancy e LGPD

Isolamento entre empresas é requisito inegociável (seção 2.1 da spec, RNF03). Toda feature que
toca dados precisa respeitar estas regras.

## Isolamento de tenant (obrigatório)

- Banco compartilhado com particionamento lógico por `tenant_id`.
- **RLS habilitado em TODAS as tabelas de domínio.** Nenhuma tabela com dado de tenant fica sem
  política de RLS.
- O `tenant_id` do usuário vem do JWT (claim/`profiles`), nunca de parâmetro enviado pelo
  cliente. Políticas RLS comparam a linha com o `tenant_id` do usuário autenticado.
- Super admin tem acesso cross-tenant **apenas** por caminhos explícitos e auditados
  (Edge Function com service role ou política específica de `super_admin`), nunca pelo cliente
  comum.

## RBAC dentro do tenant

- `admin`: tudo dentro do tenant.
- `professional`: apenas a própria agenda (`professional_id` ligado ao seu `profile_id`).
- `receptionist`: agendamentos de todos os profissionais, **sem** ler `charges`/dados
  financeiros sensíveis. RLS/colunas devem refletir isso.

## Controle por status de assinatura

- `bloqueado`/`cancelado`: bloquear escrita de dados operacionais e suspender disparos.
  A camada de app redireciona `bloqueado` para tela de quitação.

## Segredos e credenciais

- **Nunca** colocar service role key, chave Asaas, token Evolution ou segredos de webhook no
  bundle do frontend. Só `anon key` pública vai ao cliente.
- Segredos ficam em variáveis de ambiente / secrets do Supabase. Operações privilegiadas
  (webhooks, disparos, baixa de pagamento) rodam em Edge Functions com service role.
- Ao ler/editar arquivos `.env`, nunca ecoar valores de segredo em respostas.

## Webhooks (RNF04)

- **Idempotência obrigatória:** processar o mesmo evento de pagamento mais de uma vez não pode
  gerar baixa duplicada. Usar `gateway_charge_id` + id do evento como chave de deduplicação.
- **Verificar autenticidade** do webhook (assinatura/token do Asaas) antes de processar.
- Fila de retentativa para mensagens de WhatsApp com falha temporária.

## LGPD

- `whatsapp_opt_in` registra consentimento antes de qualquer disparo ao cliente final.
- Criptografia em trânsito (HTTPS/TLS) e dados sensíveis protegidos em repouso.
- Minimizar PII em logs; não logar telefone/documento em texto claro quando evitável.

## Dados não confiáveis

Payloads de webhook e respostas de API externa (Asaas, Evolution) são dados não confiáveis:
validar schema (zod) antes de usar, nunca executar conteúdo recebido.
