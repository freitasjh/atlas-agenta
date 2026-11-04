# RESEARCH — Cadastro Rico de Empresa/Tenant

> PRD: `cadastro-empresa-rico` · ≥2 alternativas com fonte (http) + trade-off + 1 recomendação por tema.

## T1 — Preenchimento de endereço: ViaCEP com fallback manual vs. manual puro

### Alternativa A — ViaCEP (CEP → auto-preenche) com fallback manual (recomendada no escopo afirmado)

- Fonte: ViaCEP — https://viacep.com.br/ (API pública `https://viacep.com.br/ws/{cep}/json/`; retorno com `erro` quando inexistente).
- Como funciona: digita CEP (8 dígitos) → `GET` → pré-preenche logradouro/bairro/cidade/UF; número/complemento sempre manuais; se falhar, tudo editável.
- Prós: menos digitação e erro; API gratuita, sem chave; formato JSON estável e amplamente usado.
- Contras: dependência externa (fora do ar / CEP novo ausente); precisa debounce + timeout + tratamento de `{"erro": true}`; ViaCEP não valida que o endereço é o da empresa — só sugere.

### Alternativa B — Manual puro (sem consulta)

- Fonte: referência de UX de formulários — GOV.BR Design System, formulários extensos aumentam abandono; cada campo extra custa conversão (https://www.gov.br/ds/); padrão de mercado prefere autocomplete de CEP justamente para reduzir esse custo.
- Prós: zero dependência externa; sem latência; sem lógica de fallback.
- Contras: mais digitação e erro (logradouro/cidade/UF à mão); CEP pode vir inválido sem checagem cruzada; pior UX no mobile.

### Recomendação

**A (ViaCEP + fallback manual)** — é o afirmado no escopo e equilibra UX e resiliência: usa ViaCEP como sugestão, nunca como autoridade; validação final é local (CEP 8 dígitos + obrigatoriedade dos 5 campos) e o cadastro conclui mesmo com ViaCEP fora. ADR deve congelar timeout/debounce e o mapeamento do `{"erro": true}` para erro pt-BR por campo.

## T2 — Validação de CNPJ/CPF: só cliente vs. cliente + servidor

### Alternativa A — Cliente + servidor (recomendada)

- Fonte: algoritmo do dígito verificador — Receita Federal, cálculo dos DV de CNPJ/CPF (https://www.gov.br/receitafederal/); implementação de referência aberta (ex. `cpf-cnpj-validator`, https://github.com/carvalhoviniciusluiz/cpf-cnpj-validator — checar licença antes de adotar).
- Como funciona: máscara + DV no cliente (feedback imediato) **e** revalidação no servidor (zod na Edge Function + check na RPC/migration); unicidade garantida pelo índice `tenants_document_key` (já existe).
- Prós: UX rápida sem confiar no cliente; integridade real (cliente é burlável); unicidade no banco fecha corrida.
- Contras: regra em dois lugares (precisa teste espelhado cliente/servidor); DV sozinho não prova existência na Receita — só formato.

### Alternativa B — Só cliente

- Fonte: mesma base de cálculo dos DV (Receita Federal, link acima); validação apenas com zod/react-hook-form no browser.
- Prós: implementação menor, sem mudança na Edge Function/RPC.
- Contras: **inseguro** — corpo é dado não-confiável (regra `seguranca-multitenant.md`); documento inválido/duplicado entraria via chamada direta; viola RNF04.

### Recomendação

**A (cliente + servidor)** — única compatível com as regras do projeto (payload não-confiável, nunca confiar no cliente). ADR congela: strip de máscara → só dígitos → tamanho 11/14 → DV → unicidade via índice; mensagem 409 pt-BR sem ecoar o valor (LGPD).

## T3 — Onde guardar o endereço: colunas em `tenants` vs. tabela `tenant_addresses`

### Alternativa A — Colunas em `tenants` (recomendada para fase 1)

- Fonte: modelagem Supabase/Postgres — tabelas amplas para 1:1 são o padrão simples; migrations aditivas com `IF NOT EXISTS` (regra `db-migration-supabase.md`, presente neste repo em `.agents/rules/db-migration-supabase.md`).
- Prós: 1 empresa = 1 endereço (afirmado); sem join; RLS existente cobre; migration aditiva simples; queries de bilhetagem leem direto do tenant.
- Contras: se um dia houver filiais/múltiplos endereços, precisa migrar para tabela própria.

### Alternativa B — Tabela `tenant_addresses` (FK composta por tenant)

- Fonte: convenção do projeto para N:1 dentro do tenant — FK composta `(tenant_id, ref_id)` e RLS por `tenant_id` (regra `db-migration-supabase.md` §8 + `dominio.md`).
- Prós: pronto para múltiplos endereços (cobrança/entrega/filial); histórico de mudanças possível.
- Contras: over-engineering para o afirmado (um endereço por empresa); join em toda leitura; mais RLS/policies/guard para auditar — custo sem benefício nesta fase.

### Recomendação

**A (colunas em `tenants`)** — cobre exatamente o afirmado (endereço único da empresa) com o menor custo e sem violar regra alguma. ADR registra a decisão e anota que filiais/múltiplos endereços, se vierem, motivam migração futura para tabela própria.

## Resumo das recomendações

| Tema | Recomendação | Decisão final |
|---|---|---|
| Endereço | ViaCEP + fallback manual (T1-A) | ADR congela timeout/debounce/erro |
| Documento | Cliente + servidor + índice único (T2-A) | ADR congela formato canônico (L2) |
| Modelagem endereço | Colunas em `tenants` (T3-A) | ADR desenha migration aditiva |

Nada aqui cria valor novo de `current_phase` nem autoriza código — o próximo passo é o portão humano (PRD §16) e depois o ADR.
