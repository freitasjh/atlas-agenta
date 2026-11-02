# Ambiente local — Atlas Agenda

Um comando sobe o sistema inteiro (Supabase + Edge Functions + Vite), popula um
tenant demo e prova o fluxo **cadastro → agenda → PIX**:

```bash
npm run dev:up
```

Variações: `bash scripts/dev-up.sh --no-smoke` (sobe sem o smoke) e
`bash scripts/dev-up.sh --reset` (**apaga** o banco local e reaplica todas as
migrations — use conscientemente).

Para encerrar:

```bash
npm run dev:down        # só functions + frontend
npm run dev:down -- --all  # também a stack Supabase
```

> O ambiente é **real**: Evolution via ngrok e Asaas **sandbox**. Não há mock no
> caminho padrão. Se o ngrok ou o Asaas estiverem fora, o `dev:up` falha no
> preflight com a causa — não sobe um ambiente mentiroso.

## Pré-requisitos

| Item | Como conferir |
|------|---------------|
| Docker rodando | `docker info` |
| Node >= 22 | `node -v` (o `package.json` declara `engines`) |
| Supabase CLI via npx | `npx supabase --version` |
| Deno | `deno --version` (o script também procura em `~/.deno/bin`) |
| Evolution acessível | instância pareada + URL pública do ngrok |
| Asaas sandbox | API key `$aact_…` **do sandbox** e uma chave Pix ativa |

### Segredos (nunca versionados)

`supabase/functions/.env` precisa conter (valores não são impressos por nenhum
script):

```
ASAAS_MASTER_KEY=…                 # criptografia das API keys dos tenants
ASAAS_SUPER_ADMIN_API_KEY=…        # conta do super admin (assinaturas/PIX)
ASAAS_SUPER_ADMIN_ENVIRONMENT=sandbox
EVOLUTION_MODE=real                # ou mock, conscientemente
EVOLUTION_API_URL=https://<ngrok>.ngrok-free.app
EVOLUTION_API_KEY=…
CUSTOM_ACCESS_TOKEN_HOOK_SECRET=…  # precisa casar com o hook do GoTrue
```

O arquivo é ignorado pelo git (`.env*`); o `dev:up` confere com
`git check-ignore` antes de qualquer coisa.

## O que cada script faz

| Script | Papel |
|--------|-------|
| `scripts/dev-up.sh` | preflight → stack → migrations → functions → Vite → seed → smoke |
| `scripts/dev-seed.mjs` | tenant demo idempotente (`admin@demo.local`, 2 serviços, profissional, grade seg-sex, link público) |
| `scripts/dev-smoke.mjs` | cadastro (201), login (200), agenda, `create-charge` (200 com QR + copia-e-cola), `public-slots`/`public-book` |
| `scripts/dev-down.sh` | encerra só o que o `dev-up` subiu, por PID + dono; `--all` para a stack |

### Seed

- tenant `Agenda Demo` em `trial`, `America/Sao_Paulo`
- admin `admin@demo.local` (senha local `demo12345`, sobrescrevível por `DEV_DEMO_PASSWORD`)
- serviços `Corte` (30 min) e `Coloração` (60 min)
- 1 profissional vinculado ao profile do admin
- grade segunda–sexta, 09:00–18:00
- 1 link público ativo → `http://localhost:5173/agendar/<token>`
- **não** cria `tenant_asaas_config`: a configuração de pagamento é do usuário.
  O smoke só configura o tenant demo quando ainda não existe configuração ativa.

Rodar o seed duas vezes não duplica nada.

### Smoke

O smoke fala HTTP real com o stack local e **não** imprime token, telefone nem
e-mail completo. Ele falha (exit ≠ 0) com status, `error` do corpo e a última
linha de `/tmp/atlas-dev/functions.log`.

Passos: cadastro de empresa → login do usuário novo → appointment `concluido`
no tenant demo → `create-charge` (200 + `charge_id`, `pix_qr_code`,
`pix_copy_paste` e `asaas_payment_id` no banco) → `public-slots`/`public-book`.

> **CPF de teste:** o schema atual de `customers` não guarda CPF/CNPJ, mas o
> sandbox do Asaas exige documento para criar cobrança. O smoke pré-aquece o
> cliente no Asaas com um CPF válido de teste (`39053344705`) e o
> `externalReference` do cliente local. É uma muleta explícita do ambiente de
> teste, não uma correção de produto.

## Troubleshooting dos erros históricos

### 1. Edge Function responde 503 / `exit 137` (OOM)

Sintoma: REST e Auth respondem 200, mas toda `/functions/v1/*` devolve 503.

Causa: o container `supabase_edge_runtime_atlas-agenda` morreu (exit 137 =
OOM killer) e o Kong continua roteando para ele.

O `dev:up`:

1. só considera o runtime vivo quando `POST /functions/v1/signup-tenant` com
   `{}` devolve **400** (prova de runtime, não de Kong);
2. em 503, mostra `status/exit/oom` do container e o trecho de log;
3. reinicia o runtime **uma vez**;
4. se repetir, aborta com diagnóstico em vez de fingir sucesso.

Ação manual: libere RAM do host/Docker. `bash scripts/dev-down.sh --all` e
`npm run dev:up` de novo.

### 2. Drift de WhatsApp (`connection_status='conectado'` sem instância)

Sintoma: a UI diz conectado, mas não há instância no Evolution.

Causa: sessões antigas rodaram com `EVOLUTION_MODE=mock` e gravaram estado
otimista no banco.

O `dev:up` valida `EVOLUTION_MODE=real` chamando
`<EVOLUTION_API_URL>/instance/fetchInstances` com a apikey. Se o ngrok caiu, ele
falha antes de subir o resto. Para corrigir o drift, reconecte a instância em
`/app/config/whatsapp` (o estado do banco é reconciliado pela função
`whatsapp`).

### 3. `deno: command not found`

Causa: o Deno fica em `~/.deno/bin`, que não está no PATH do shell não
interativo.

O `dev:up` adiciona `$HOME/.deno/bin` automaticamente; se ainda faltar,
instrui:

```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$HOME/.deno/bin:$PATH"
```

### 4. Asaas 401 no preflight

Chaves do Asaas são **por ambiente**. Uma chave de produção não vale no
sandbox (e vice-versa). Confira `ASAAS_SUPER_ADMIN_ENVIRONMENT` e se a chave
começa com `$aact_`. Nenhum script imprime o valor.

### 5. Asaas recusa a cobrança PIX

Se o preflight avisar "nenhuma chave Pix ATIVA", cadastre uma chave Pix na
conta sandbox (Pix → Chaves). A propagação pode levar alguns minutos.

## Notas de segurança

- `supabase/functions/.env` e `.env` são ignorados pelo git; o preflight falha
  se o arquivo de functions não estiver ignorado.
- Nenhum script faz `pkill -f`. Portas e processos são identificados por
  PID/dono; processo de outro projeto nunca é encerrado.
- Tokens de sessão do smoke ficam só em memória; a saída não os imprime.
