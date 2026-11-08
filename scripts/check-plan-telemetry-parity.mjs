/**
 * Trava de paridade de preço da telemetria de planos (plan-telemetry-pacote).
 *
 * Garante que `supabase/functions/_shared/plans.json` (fonte única) e o CASE
 * de `supabase/migrations/20261108150000_plan_telemetry.sql`
 * (`plan_price_cents`) carregam os mesmos centavos por slug. Divergência =
 * exit 1 (usado no CI).
 *
 * Uso: `node scripts/check-plan-telemetry-parity.mjs`
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLANS_JSON = resolve(ROOT, "supabase/functions/_shared/plans.json");
const MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261108150000_plan_telemetry.sql",
);

const prices = JSON.parse(readFileSync(PLANS_JSON, "utf8"));
const migration = readFileSync(MIGRATION, "utf8");

let failed = false;
for (const [slug, cents] of Object.entries(prices)) {
  const whenRe = new RegExp(`when\\s+'${slug}'\\s+then\\s+${cents}\\b`);
  if (!whenRe.test(migration)) {
    console.error(
      `PARITY FAIL: migration sem "when '${slug}' then ${cents}" (plans.json diz ${slug}=${cents})`,
    );
    failed = true;
  }
}

// Nenhum literal estranho no CASE: só os 3 valores do JSON.
const caseBlock = migration.slice(
  migration.indexOf("create or replace function public.plan_price_cents"),
  migration.indexOf("comment on function public.plan_price_cents"),
);
const literals = [...caseBlock.matchAll(/\bthen\s+(\d+)\b/g)].map((m) => Number(m[1]));
const expected = new Set(Object.values(prices));
for (const lit of literals) {
  if (!expected.has(lit)) {
    console.error(`PARITY FAIL: literal inesperado ${lit} no CASE de plan_price_cents`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  `PARITY OK: plans.json ${JSON.stringify(prices)} espelhado em plan_price_cents`,
);
