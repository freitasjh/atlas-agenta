import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";
import { getPlan, PLAN_SLUGS } from "@/lib/plans";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "@/types/payments";

/**
 * Invariantes de domínio da Fase 0 (roadmap §9.2) cobertos sem banco.
 * Invariantes que exigem Postgres (snapshot de comissão, ledger append-only,
 * RLS, idempotência de RPC, advisory lock de quota) vivem na suíte de
 * integração e estão referenciados em `docs/DoD.md` — aqui só o que é
 * travável em unitário.
 */

const ROOT = process.cwd();
const CATALOG_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261114000000_plan_catalog_ssot.sql",
);

function createTablePlans(source: string): string {
  const match = source.match(/create table if not exists public\.plans \([\s\S]*?\);/);
  if (!match) throw new Error("bloco CREATE TABLE public.plans não encontrado");
  return match[0];
}

describe("invariante: dinheiro em centavos inteiros (*_cents)", () => {
  it("parse de pt-BR devolve inteiro exato (sem float)", () => {
    expect(parseBRLToCents("45,00")).toBe(4500);
    expect(parseBRLToCents("R$ 1.234,56")).toBe(123456);
    expect(parseBRLToCents("45.00")).toBe(4500);
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
  });

  it("formatação parte de centavos inteiros", () => {
    expect(formatCentsToBRL(4500)).toContain("45,00");
    expect(formatCentsToBRL(0)).toContain("0,00");
  });

  it("fallback de planos usa price_cents inteiros não-negativos", () => {
    for (const slug of PLAN_SLUGS) {
      const cents = getPlan(slug).price_cents;
      expect(Number.isInteger(cents), `${slug} não-inteiro`).toBe(true);
      expect(cents, `${slug} negativo`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("invariante: catálogo v1 de métodos e estados de pagamento", () => {
  it("PAYMENT_METHODS é exatamente o v1 (sem método novo sem migração)", () => {
    expect([...PAYMENT_METHODS]).toEqual([
      "dinheiro",
      "cartao_credito",
      "cartao_debito",
      "pix_sistema",
      "pix_maquininha",
    ]);
  });

  it("PAYMENT_STATUSES é exatamente o v1", () => {
    expect([...PAYMENT_STATUSES]).toEqual([
      "sem_pagamento",
      "parcial",
      "quitado",
      "aguardando_pix",
    ]);
  });
});

describe("invariante: plans é catálogo global sem tenant_id (exceção declarada)", () => {
  it("CREATE TABLE public.plans não tem coluna tenant_id", () => {
    const block = createTablePlans(readFileSync(CATALOG_MIGRATION, "utf8"));
    expect(block).not.toMatch(/tenant_id/);
  });

  it("RLS de plans é leitura pública sem escrita de cliente", () => {
    const source = readFileSync(CATALOG_MIGRATION, "utf8");
    expect(source).toContain("plans_public_read");
    expect(source).not.toMatch(/create policy \S+ on public\.plans for (insert|update|delete)/i);
  });
});
