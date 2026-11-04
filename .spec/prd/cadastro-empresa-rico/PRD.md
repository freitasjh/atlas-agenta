# PRD — Cadastro Rico de Empresa/Tenant (fase 1: empresa-primeiro)

> PRD-ID: `cadastro-empresa-rico` · Tipo de rota: **Melhoria** (evolução de cadastro existente) · Status: `approved` (§16 aprovado em 2026-11-04)

## §1 — Visão geral (obrigatória)

Evoluir o cadastro em `/cadastro` (Edge Function `signup-tenant` → RPC `create_tenant_with_admin` → `tenants`) para coletar desde o primeiro cadastro os dados cadastrais da empresa necessários à **bilhetagem futura** (nota fiscal, cobrança, identificação do emitente), sem antecipar fases futuras.

Fase 1 cobre **só empresa**. WhatsApp/Evolution e funcionário/usuário ficam explicitamente fora (ver §4).

Base técnica verificada no repo (2026-11-04, não assumida):

- `tenants` (`20250216090000_tenants.sql`) já tem `legal_name`, `trade_name`, `document`, `owner_email`, `phone` — **endereço NÃO existe**.
- `signup-tenant/schemas.ts`: `.strict()` com `email`, `password`, `trade_name`, `full_name?`, `segment?` — nada de documento/telefone/endereço hoje.
- RPC `create_tenant_with_admin(p_user_id, p_owner_email, p_trade_name, p_full_name, p_segment)` (`20250301090000_…`) — insere `legal_name = trade_name`, sem documento/telefone/endereço.
- `CadastroPage` (`src/auth/CadastroPage.tsx`) + `signupSchema` (`src/lib/validations/auth.ts`) coletam só `tradeName`/`segment`/`email`/`senha` (+ `confirmPassword` só cliente).

## §2 — Problema (obrigatória)

O cadastro atual cria a empresa com `legal_name = trade_name` e sem documento, telefone próprio ou endereço. Para emitir cobrança/nota no futuro, esses dados teriam de ser recolhidos depois, com retrabalho e risco de base inconsistente (documento duplicado, endereço parcial). O cadastro rico fecha essa lacuna na origem, mantendo o fluxo em uma transação só no servidor.

## §3 — Personas

- **Dono da empresa (admin)**: preenche o cadastro em `/cadastro`; quer criar a conta rápido e não repetir dados depois.
- **Super Admin (fundadores)**: consome os dados cadastrais na bilhetagem futura e na gestão de tenants (`/admin`).
- **Fora deste PRD**: profissional, recepção, funcionário adicional (fase 2).

## §4 — Escopo

### ENTRA (fase 1, cadastro empresa)

| Campo | Regra afirmada |
|---|---|
| Razão social (`legal_name`) | Opcional; fallback = nome fantasia (`trade_name`) quando vazia |
| Nome fantasia (`trade_name`) | Obrigatório (já existe) |
| CNPJ/CPF (`document`) | **Obrigatório**; aceita CPF (11) ou CNPJ (14), só dígitos; dígito verificador válido; **único** (já há índice único parcial) |
| Telefone da empresa (`phone`) | **Obrigatório**; máscara BR; campo separado (não é WhatsApp) |
| E-mail | O da empresa/login; **sem campo separado** (equivale a `owner_email` = e-mail do login) |
| Endereço | **Obrigatório**: CEP + logradouro + número + complemento (opcional) + cidade + UF; consulta ViaCEP com **fallback manual** (usuário digita tudo se ViaCEP falhar) |
| Nome do admin (`full_name`) | **Obrigatório** (hoje é opcional no schema) |
| Segmento (`segment`) | Mantido como hoje (enum `barbearia|clinica|salao`, opcional) |
| Senha | Mantida como hoje (regras existentes, sem mudança) |

### NÃO ENTRA (fora de escopo explícito)

- **WhatsApp no cadastro** — vai na configuração da empresa com Evolution API, fase futura. Nenhum campo `whatsapp` no `/cadastro`, no schema da Edge Function nem na RPC desta fase.
- **Funcionário/usuário** — fase 2. Nenhum convite, cargo ou vínculo adicional neste PRD.
- **Templates de e-mail por papel** — fora.
- **Autoagendamento público, taxa de reserva, painel métricas** — fora (MVP fase 1, `produto.md`).

## §5 — Requisitos funcionais (obrigatória)

Formato BDD (`Dado/Quando/Então`). Erros em pt-BR, sem vazar PII.

- **RF01 — Razão social com fallback**
  - `Dado` usuário informa nome fantasia e deixa razão social vazia, `Quando` submete, `Então` `legal_name = trade_name` (comportamento atual preservado).
  - `Dado` usuário informa razão social, `Quando` submete, `Então` `legal_name` = valor informado (trim, 2–120, mesmo teto de `trade_name` salvo prova em contrário no design).
- **RF02 — CNPJ/CPF obrigatório e válido**
  - `Dado` documento vazio ou só máscara, `Quando` submete, `Então` erro pt-BR "Informe o CNPJ ou CPF." e nada é persistido.
  - `Dado` documento com tamanho ≠ 11/14 dígitos (após strip de máscara) ou dígito verificador inválido, `Quando` submete, `Então` erro pt-BR "CNPJ/CPF inválido." (cliente + servidor, mesma regra).
  - `Dado` documento já cadastrado em outro tenant, `Quando` submete, `Então` erro 409 pt-BR "Este CNPJ/CPF já tem cadastro." (mapeia a violação do índice `tenants_document_key`; mensagem exata a congelar no design/ADR).
- **RF03 — Telefone da empresa obrigatório**
  - `Dado` telefone vazio, `Quando` submete, `Então` erro pt-BR "Informe o telefone da empresa.".
  - `Dado` telefone informado, `Quando` persiste, `Então` gravado em `tenants.phone` (formato canônico a congelar no design: E.164 vs só dígitos BR — **lacuna aberta L2**, ver §12).
- **RF04 — E-mail único (sem campo separado)**
  - `Dado` o formulário, `Quando` renderiza, `Então` existe um único campo de e-mail (login = e-mail da empresa = `owner_email`); nenhum `company_email` separado.
- **RF05 — Endereço obrigatório com ViaCEP + fallback manual**
  - `Dado` CEP válido com resposta ViaCEP, `Quando` consulta, `Então` logradouro/cidade/UF pré-preenchidos, editáveis; número sempre manual; complemento opcional.
  - `Dado` ViaCEP fora do ar ou CEP não encontrado, `Quando` consulta, `Então` todos os campos de endereço ficam editáveis manualmente e o cadastro pode concluir sem depender do serviço.
  - `Dado` CEP/logradouro/número/cidade/UF vazios, `Quando` submete, `Então` erro pt-BR por campo e nada é persistido.
- **RF06 — Nome do admin obrigatório**
  - `Dado` nome do admin vazio, `Quando` submete, `Então` erro pt-BR "Informe seu nome."; `p_full_name` passa a obrigatório na RPC.
- **RF07 — Contrato estrito preservado**
  - `Dado` corpo com campo extra (ex. `role`, `tenant_id`, `whatsapp`), `Quando` chega à Edge Function, `Então` recusado por `.strict()` (`invalid_body`), sem escrita.

## §6 — Requisitos não-funcionais (obrigatória)

- **RNF01 — Performance**: sem regressão no carregamento do `/cadastro`; consulta ViaCEP com debounce + timeout (valor a congelar no design; sem número inventado aqui).
- **RNF02 — Mobile-first**: novos campos seguem o padrão responsivo existente (RNF02 do produto).
- **RNF03 — i18n**: todo texto visível via `react-i18next`, pt-BR default; mensagens de erro por campo, sem literal solto (convenção frontend-react).
- **RNF04 — Validação dupla**: documento/telefone/CEP validados no cliente (UX imediata) **e** no servidor (zod na Edge Function + check na RPC/migration); cliente nunca é autoridade.
- **RNF05 — Idempotência/rollback**: preservado o molde atual — RPC transacional (empresa + profile admin + templates); falha na RPC remove o usuário Auth recém-criado, sem empresa parcial.

## §7 — Regras de negócio (obrigatória)

- **RN01**: `document` obrigatório nesta fase em diante para novos cadastros; único quando presente (índice existente). Normalização: armazenar só dígitos (decisão de formato canônico — ver L2; sem divergir entre cliente/servidor/banco).
- **RN02**: `legal_name` vazio ⇒ `legal_name = trade_name` (fallback afirmado; sem default silencioso em nenhum outro campo).
- **RN03**: `owner_email` = e-mail do login; proibido campo separado de e-mail da empresa nesta fase.
- **RN04**: `phone` (empresa, obrigatório) ≠ WhatsApp operacional; nenhum vínculo com Evolution API neste PRD.
- **RN05**: Endereço novo (tabela/colunas a desenhar no ADR — `tenants` hoje não tem endereço): CEP + logradouro + número + complemento? + cidade + UF; complemento é o único opcional.
- **RN06**: Pré-produção **sem trava de compat**: pode revisar cadastros antigos além do documentado? **Não** — proibido prometer compatibilidade com cadastros antigos além do documentado; migração/backfill de base legada (document/telefone/endereço nulos) é **lacuna aberta L1** (ver §12), a decidir no design/ADR com gate humano.
- **RN07**: LGPD (§10) prevalece sobre conveniência: documento/telefone nunca em logs; sem log de endereço completo em claro além do mínimo operacional.

## §8 — Fluxos / UX

1. Usuário abre `/cadastro` (com ou sem `?plano=` — apresentação inalterada).
2. Preenche: nome fantasia, razão social (opcional), CNPJ/CPF (com máscara dinâmica 11↔14), telefone empresa (máscara BR), e-mail, senha + confirmação, nome do admin, segmento, endereço (CEP → ViaCEP → completa número; fallback manual).
3. Validação inline por campo (react-hook-form + zod, mensagens pt-BR).
4. Submissão → `signup-tenant` (corpo estrito ampliado) → Auth + RPC transacional → auto-login e redirect pós-login inalterados (molde ADR-02/ADR-03/ADR-08 citado no `CadastroPage`).
5. Falha (documento duplicado, ViaCEP fora): erro por campo/bloquinho, foco no feedback (`role=alert`, padrão existente), nada parcial persistido.
6. Impacto UX a validar com `@ux_designer` no design: ordem dos campos, máscaras, comportamento do fallback ViaCEP, acessibilidade (labels, foco, teclado).

## §9 — Impacto técnico (obrigatória)

Verificado no disco (não assumido); desenho final no ADR:

| Camada | Hoje | Impacto desta fase |
|---|---|---|
| `CadastroPage.tsx` + `signupSchema` | só `tradeName/segment/email/senha` | + razão social, documento, telefone, endereço (6 campos), `full_name` obrigatório; máscaras; i18n |
| `signup-tenant/schemas.ts` (`.strict()`) | `email/password/trade_name/full_name?/segment?` | + `legal_name?`, `document!`, `phone_empresa!`, endereço!, `full_name!`; validadores de dígito (CPF/CNPJ), telefone BR, CEP/UF |
| `signup-tenant/index.ts` | repassa 5 params à RPC; log sem PII | repassa novos params; **nenhum log de documento/telefone/endereço**; novo código 409 de documento duplicado |
| RPC `create_tenant_with_admin` | 5 params; `legal_name = trade_name` | + params (documento, telefone, endereço, legal_name); `NOT NULL`/checks novos; erro `document_duplicado` mapeável; `EXECUTE` segue só `service_role` |
| `tenants` | sem endereço | migration aditiva (`IF NOT EXISTS`): colunas de endereço (+ `NOT NULL` em `document`/`phone` p/ novos? — ver L1) + guard de colunas privilegiadas estendido se preciso; RLS inalterado (mesmo tenant) |
| Testes | `schemas.test.ts`, `CadastroPage.signup.test.tsx` | estender: dígitos CPF/CNPJ válidos/inválidos, unicidade, fallback razão social, ViaCEP ok/falha, `.strict()` recusando `whatsapp` |

Sem mudança em: Auth (confirmação segue desligada no MVP), planos, templates da régua (seed inalterado), Evolution API, RBAC.

## §10 — Segurança / LGPD

- Documento/telefone/endereço: **nunca em logs** (nem Edge Function, nem cliente, nem testes com dado real); erro de unicidade genérico por campo, sem ecoar o valor.
- Payload da Edge Function segue não-confiável: validar schema (zod) antes de usar; `.strict()` recusa `role`/`tenant_id`/`whatsapp`.
- Consentimento WhatsApp (`whatsapp_opt_in`) **fora deste PRD** — nada a coletar aqui.
- Segredos: nenhum no bundle; service role só na Edge Function (molde atual).
- Auditoria de segurança no design via `security-review` (OWASP/ASVS) — mascaramento de PII na UI (exibir CNPJ parcial) a decidir no ADR, sem inventar regra aqui.

## §11 — Métricas de sucesso

- **Aceite = o descrito** (afirmado): cadastro conclui com todos os campos §4 válidos; fallback razão social funciona; ViaCEP + fallback manual funcionam; documento duplicado recusado com 409 pt-BR; nenhum campo WhatsApp/funcionário exposto.
- **Zero regressão**: auto-login/redirect, seed de templates e suite existente verdes.
- **Observabilidade sem PII**: taxa de falha ViaCEP e de `invalid_body` monitoráveis sem logar valores.

## §12 — Riscos e lacunas abertas (nada preenchido com default)

- **L1 — Base legada (document/telefone/endereço nulos)**: cadastros antigos não têm os novos obrigatórios. Opções (backfill obrigatório vs. `NOT NULL` só p/ novos vs. bloqueio de login até completar) **não decididas** — vão ao ADR com gate humano. Nenhuma compatibilidade prometida além do documentado.
- **L2 — Formato canônico**: só-dígitos vs. E.164 (telefone) e CEP com/sem hífen; UF sigla validada contra lista IBGE? Sem decisão — ADR congela, cliente+servidor+banco idênticos.
- **L3 — Mensagem do 409 de documento**: texto exato pt-BR e mapeamento do erro PG (`unique_violation` → `document_ja_cadastrado`) a congelar no design.
- **L4 — ViaCEP**: timeout/debounce/cache e comportamento offline детalhados no ADR (RESEARCH recomenda — ver `RESEARCH.md`).
- **L5 — Escopo de endereço**: endereço é da empresa (um por tenant) — confirmado pelo afirmado; múltiplos endereços (filiais/cobrança) são fase futura, não desenhados aqui.
- **Risco inventado? Não** — nenhum requisito além do afirmado foi incluído; tudo acima é pergunta, não resposta.

## §13 — Alternativas consideradas

Ponte para `RESEARCH.md` (≥2 alternativas com fonte + trade-off + recomendação): ViaCEP vs. manual puro; validação de documento só-cliente vs. cliente+servidor; endereço embutido em `tenants` vs. tabela própria. Recomendação registrada lá; decisão final no ADR.

## §14 — Plano de rollout / fases

1. **PRD** (este artefato) → portão humano §16.
2. **RESEARCH** (já entregue) → **ADR** (1 ADR de cadastro: schema + RPC + migration + UI) → SDD scoped.
3. Implementação atrás da mesma transação server-side; sem feature flag afirmada (lacuna: flag ou direto? — ADR decide).
4. Pré-produção sem trava de compat (afirmado): sem migração de compat prometida além do que o ADR documentar (ver L1).

## §15 — Rastreabilidade

- Fonte da demanda: delegação `product-manager` (fase PRD da esteira PRD→ADR→SDD), escopo/aceite afirmados no bloco `<context>` (fase empresa-primeiro, ViaCEP, doc/tel obrigatórios, sem compat extra).
- SSoT técnico: `src/auth/CadastroPage.tsx`, `src/lib/validations/auth.ts`, `supabase/functions/signup-tenant/{schemas,index}.ts`, migrations `20250216090000_tenants.sql` + `20250301090000_signup_tenant_rpc_e_drop_trigger.sql`, regras `produto.md`, `seguranca-multitenant.md`, `db-migration-supabase.md`, `convencoes-codigo.md`, `prd-adr-pipeline.md`.
- Fora de escopo rastreado: Evolution/WhatsApp (configuração futura), funcionário (fase 2), templates por papel.

## §16 — Aprovação humana (obrigatória — BLOCO VAZIO, ponto de parada)

> Nenhum `ADRs/**` nasce antes deste bloco estar preenchido. Humano aprova antes do design.

- [x] Aprovado por: humano (portão P-PRD) em 2026-11-04
- Veredito: aprovado pelo humano via portão P-PRD em 2026-11-04 — autorizado abrir ADRs de cadastro (001 schema tenants endereço, 002 RPC + Edge signup-tenant, 003 UI CadastroPage + validações + ViaCEP)
- [x] Decisão L1 (base legada): delegada ao ADR-001 — ADR decide tratamento de cadastros antigos (document/telefone/endereço nulos) com gate humano, sem compatibilidade prometida além do documentado
- [x] Decisão L2 (formato canônico documento/telefone/CEP): delegada aos ADR-001/ADR-002 — ADRs congelam formato (só-dígitos vs E.164, UF maiúscula) com motivo, cliente+servidor+banco idênticos
- [x] Autorização para abrir ADR de cadastro: [x] sim [ ] não
