# Débito — ADR-005 (vínculo profissional/login): achados de code review (não aplicados agora)

**Origem:** code review do ADR-005 (vinculação de login a profissional).

Itens registrados como tech-debt; não aplicados nesta rodada (decisão de produto/observabilidade).

## Itens

- [ ] `accept-invitation`: `getUserByEmail` falha silenciosa — adicionar observabilidade (log estruturado) sem vazar PII.
- [ ] `unlink-professional-profile`: confirmar se "Revogar acesso" deve também desativar o usuário (decisão de produto). Hoje mantém o registro operacional.
- [ ] i18n: strings pt-BR literais nos diálogos (projeto não adota i18n ainda) — migrar quando a infra de i18n for introduzida.

## Critérios

- Não bloqueia release atual.
- Reavaliar a cada sprint.
