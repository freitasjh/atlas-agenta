---
name: agenda-scheduling
description: Implementar a lógica de agenda - grade de horários, geração de slots disponíveis, prevenção de conflito/sobreposição por profissional, e a máquina de estados do agendamento. Use ao trabalhar no módulo de agenda, criação/edição de agendamentos ou cálculo de disponibilidade.
---

# Agenda e Agendamentos (slots, conflitos, estados)

Implementa RF03-RF07: serviços, grade de horários, CRUD de agendamento, prevenção de conflito e
máquina de estados.

## Grade de horários (RF04)

`working_hours` por profissional e dia da semana, com intervalo de almoço:
`weekday (0-6)`, `start_time`, `end_time`, `break_start`, `break_end`.

## Geração de slots disponíveis

Para um profissional + serviço + dia:

1. Pegar a janela do dia em `working_hours` (descontando o almoço).
2. Fatiar em slots do tamanho `services.duration_minutes`.
3. Remover slots que colidem com agendamentos existentes (status ativo) do profissional.
4. Remover slots no passado.

Trabalhar sempre com `timestamptz` em UTC internamente; converter para o fuso do tenant
(`tenants.timezone`, default `America/Sao_Paulo`) só na exibição. Cuidado com horário de verão
ao fatiar slots — calcular no fuso do tenant e persistir em UTC.

## Prevenção de conflito (RF06) — dupla camada

**No banco** (fonte da verdade), constraint de exclusão:
```sql
create extension if not exists btree_gist;
alter table appointments
  add constraint no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status not in ('cancelado','nao_compareceu'));
```
**Na aplicação:** checar disponibilidade antes de submeter e tratar o erro de violação da
constraint com mensagem pt-BR amigável (ex.: "Este horário acabou de ser ocupado").

## Máquina de estados (RF07)

Estados: `pendente`, `confirmado`, `em_atendimento`, `concluido`, `cancelado`,
`nao_compareceu`.

Transições válidas:
```
pendente      -> confirmado | em_atendimento | cancelado | nao_compareceu
confirmado    -> em_atendimento | cancelado | nao_compareceu
em_atendimento-> concluido | cancelado
concluido     -> (final)
cancelado     -> (final)
nao_compareceu-> (final)
```
Validar transição antes de aplicar; rejeitar pulos inválidos. Efeitos colaterais:
- `confirmado`: setar `confirmed_at` (via resposta D-1 ou recepção).
- `concluido`: disparar geração de cobrança PIX (asaas-pix) + mensagem de cobrança
  (whatsapp-evolution).

## Isolamento e RBAC

- Todo agendamento carrega `tenant_id`; RLS isola por empresa.
- `professional` só enxerga/edita a própria agenda; `receptionist` gerencia todos os
  profissionais mas não vê financeiro; `admin` vê tudo.

## Checklist

- [ ] Slots calculados no fuso do tenant, persistidos em UTC.
- [ ] Constraint de não-sobreposição no banco + checagem na app.
- [ ] Transições de estado validadas; efeitos colaterais disparados nos pontos certos.
- [ ] Mensagens de conflito/erro em pt-BR.
