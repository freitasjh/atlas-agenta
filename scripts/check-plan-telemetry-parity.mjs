/**
 * Trava de paridade do catálogo de planos (T1.0b).
 *
 * Garante que o seed final da tabela `public.plans` (migration do catálogo
 * T1.0 + rename do ladder em `20261115000000_plan_rename_ladder.sql`) carrega
 * os mesmos centavos por slug que o fallback estático do frontend
 * (`src/lib/plans.ts`, consumido quando a RPC `get_plans()` falha ou volta
 * vazia). O `plans.json` foi removido no Batch 0.3. Divergência = exit 1.
 *
 * O preço de verdade é lido da tabela; o fallback só precisa espelhar o seed
 * para a UI não divergir.
 *
 * Uso: `node scripts/check-plan-telemetry-parity.mjs`
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261114000000_plan_catalog_ssot.sql",
);
const RENAME_MIGRATION = resolve(
  ROOT,
  "supabase/migrations/20261115000000_plan_rename_ladder.sql",
);
const SRC_PLANS = resolve(ROOT, "src/lib/plans.ts");

const EXPECTED = {
  free: 0,
  starter: 5900,
  premium: 14900,
  enterprise: 25900,
};

const catalog = readFileSync(CATALOG_MIGRATION, "utf8");
const rename = readFileSync(RENAME_MIGRATION, "utf8");
const frontend = readFileSync(SRC_PLANS, "utf8");

// Estado final do seed: o seed T1.0 usa os slugs antigos e a migration de
// rename os migra via UPDATE (histórico preservado) + insere o free.
const seedRe = /'([a-z0-9_-]+)',\s*'[^']*',\s*(\d+),\s*(\d+|null),\s*(\d+|null),/g;
const finalSeed = new Map();
for (const match of catalog.matchAll(seedRe)) {
  finalSeed.set(match[1], Number(match[2]));
}
const pairRe =
  /update\s+public\.plans\s+set\s+slug\s*=\s*'([a-z0-9_-]+)'[^;]*?where\s+slug\s*=\s*'([a-z0-9_-]+)'/gs;
for (const match of rename.matchAll(pairRe)) {
  const price = finalSeed.get(match[2]);
  finalSeed.delete(match[2]);
  if (price !== undefined) finalSeed.set(match[1], price);
}
const freeMatch = /'free',\s*'[^']*',\s*(\d+)\b/.exec(rename);
if (freeMatch) finalSeed.set("free", Number(freeMatch[1]));

let failed = false;
for (const [slug, cents] of Object.entries(EXPECTED)) {
  if (finalSeed.get(slug) !== cents) {
    console.error(`PARITY FAIL: seed final sem '${slug}' → ${cents}`);
    failed = true;
  }
  const fallbackRe = new RegExp(`slug:\\s*"${slug}"[\\s\\S]*?price_cents:\\s*${cents}\\b`);
  if (!fallbackRe.test(frontend)) {
    console.error(`PARITY FAIL: fallback do frontend sem '${slug}' → ${cents}`);
    failed = true;
  }
}

const fnBlock = catalog.slice(
  catalog.indexOf("create or replace function public.plan_price_cents"),
  catalog.indexOf("comment on function public.plan_price_cents"),
);
if (!/from\s+public\.plans/.test(fnBlock)) {
  console.error("PARITY FAIL: plan_price_cents não lê public.plans");
  failed = true;
}

if (failed) {
  process.exit(1);
}
console.log(
  `PARITY OK: seed final e fallback do frontend em ${JSON.stringify(EXPECTED)}`,
);
