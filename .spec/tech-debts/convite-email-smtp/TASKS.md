# Tech Debt: Envio de E-mail de Convite (SMTP / Régua própria)

## Contexto
Convites por e-mail usam `supabase.auth.admin.inviteUserByEmail` (Supabase Auth built-in). Em dev: Inbucket (localhost:54324). Em prod: SMTP customizado (Project Settings → Auth → SMTP) ou built-in (rate-limited, não recomendado para produção).

## Pontos de atenção
1. Configurar SMTP customizado (Resend/SendGrid/SES) no projeto Supabase antes de produção.
2. `SITE_URL` env var nas Edge Functions deve estar configurada (link de redirect).
3. Envio é best-effort: falha não desfaz o convite; UI não informa entrega. Considerar feedback "e-mail pode demorar" + status de entrega.
4. Template de e-mail é o padrão do Supabase Auth (não branded). Régua própria (Resend + template customizado por papel) seria feature futura.
5. Sem tracking de abertura/clique.

## Prioridade
P2 (importante para produção, não bloqueia MVP).

## Relacionado
- ADR-002 (invite-member, accept-invitation)
- ADR-005 (convite de profissional)
