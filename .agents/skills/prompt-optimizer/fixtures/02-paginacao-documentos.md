---
esperado: rota-b
---

# Paginação por cursor em documentos

Acrescentar paginação por cursor em `GET /v1/documents` para que a listagem não traga a coleção inteira de uma vez. Escopo: só esse endpoint do módulo `document`; não tocar `POST /v1/documents` nem o frontend. Limite padrão 20, máximo 100 — manter o formato de resposta atual dos clientes existentes. Feature nova. Pronto quando o IT de paginação cobrir 1ª página, última página e `limit=200` clampado para 100, e o contrato de sucesso permanecer idêntico.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
