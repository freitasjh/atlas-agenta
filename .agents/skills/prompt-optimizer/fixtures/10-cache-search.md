---
esperado: rota-a
bloqueio: E5
---

# Extrair política de cache

Extraia a lógica de expiração do cache de `SearchCache` para uma classe `CachePolicy`, deixando a classe original como fachada. Escopo: só o módulo `search`, backend, sem tocar frontend nem o contrato da API. Não pode mudar a assinatura pública de `SearchCache` nem o comportamento observável — incluindo o fallback quando o cache falha. Refactor puro.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ❌ · E6 ✅ → Rota A; bloqueio E5 (sem condição de parada observável).
