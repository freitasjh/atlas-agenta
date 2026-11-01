// Estado final do banco após a ADR-12 (RQ-15 da ADR-13): as colunas, funções, trigger e policy do
// desenho antigo de senha não existem; as migrações já aplicadas permanecem intactas.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sql } from "../helpers/sql.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** `git` com os argumentos citados: nenhuma entrada externa vira sintaxe de shell. */
function git(args: readonly string[]): string {
  const command = ["git", ...args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`)].join(" ");
  return execSync(command, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Base do range em curso: onde a branch atual se separou de `master`.
 *
 * Nunca `HEAD` sozinho: comparar com `HEAD` só enxerga a árvore de trabalho, então uma migração
 * editada e já COMMITADA na branch passaria batido. `MIGRATIONS_BASELINE` permite ancorar num
 * commit explícito quando não há `master` no clone.
 */
function resolveBaseline(): string {
  const override = process.env.MIGRATIONS_BASELINE;
  if (override && override.trim() !== "") {
    return git(["rev-parse", "--verify", `${override.trim()}^{commit}`]);
  }
  for (const ref of ["master", "origin/master"]) {
    try {
      return git(["merge-base", "HEAD", ref]);
    } catch {
      // ref ausente neste clone: tenta a próxima.
    }
  }
  return git(["rev-parse", "HEAD"]);
}

const BASELINE = resolveBaseline();

/** Migrações que já existiam na base do range — as "antigas" que não podem ser editadas. */
function baselineMigrations(): string[] {
  return git(["ls-tree", "-r", "--name-only", BASELINE, "--", "supabase/migrations"])
    .split("\n")
    .filter((line) => line.endsWith(".sql"));
}

function count(query: string): number {
  return Number(sql(query));
}

describe("RQ-15 colunas de senha removidas de profiles", () => {
  it("must_change_password, password_changed_at e password_change_claimed_until não existem", () => {
    const remaining = count(
      `select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name in ('must_change_password','password_changed_at','password_change_claimed_until');`,
    );
    expect(remaining).toBe(0);
  });
});

describe("RQ-15 funções e trigger do desenho antigo removidos", () => {
  it("funções de reserva, flag e guarda não existem no schema public", () => {
    const remaining = count(
      `select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'claim_password_change',
            'release_password_change_claim',
            'finish_password_change',
            'complete_password_change',
            'current_must_change_password',
            'profiles_guard_privileged_columns'
          );`,
    );
    expect(remaining).toBe(0);
  });

  it("trigger profiles_guard_privileged_columns_trg não existe", () => {
    const remaining = count(
      `select count(*) from pg_trigger
        where not tgisinternal and tgname = 'profiles_guard_privileged_columns_trg';`,
    );
    expect(remaining).toBe(0);
  });

  it("policy profiles_update_self_or_admin não existe", () => {
    const remaining = count(
      `select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'profiles'
          and policyname = 'profiles_update_self_or_admin';`,
    );
    expect(remaining).toBe(0);
  });

  it("nenhuma policy cita must_change_password", () => {
    const remaining = count(
      `select count(*) from pg_policies
        where qual::text like '%must_change_password%'
           or with_check::text like '%must_change_password%';`,
    );
    expect(remaining).toBe(0);
  });
});

describe("RQ-13 cliente perdeu a escrita de profiles", () => {
  it("authenticated tem SELECT e não tem INSERT, UPDATE nem DELETE", () => {
    expect(
      sql("select has_table_privilege('authenticated','public.profiles','SELECT');"),
    ).toBe("t");
    expect(
      sql("select has_table_privilege('authenticated','public.profiles','INSERT');"),
    ).toBe("f");
    expect(
      sql("select has_table_privilege('authenticated','public.profiles','UPDATE');"),
    ).toBe("f");
    expect(
      sql("select has_table_privilege('authenticated','public.profiles','DELETE');"),
    ).toBe("f");
  });
});

describe("RQ-15 migrações aplicadas não foram editadas", () => {
  it("nenhuma migração da base do range foi alterada, removida ou renomeada", () => {
    const migrations = baselineMigrations();
    expect(migrations.length, "nenhuma migração encontrada na base do range").toBeGreaterThan(0);

    // Estado da árvore de trabalho E dos commits da branch, desde a separação de `master`.
    // `--diff-filter=MDR`: adicionar migração nova é permitido — só alterar, remover ou renomear
    // uma já aplicada viola o D-11.
    const changed = git([
      "diff",
      "--name-status",
      "--diff-filter=MDR",
      BASELINE,
      "--",
      "supabase/migrations",
    ])
      .split("\n")
      .filter((line) => line.trim() !== "");

    expect(
      changed,
      `Migração aplicada alterada/removida/renomeada (D-11). Alterações desde ${BASELINE.slice(0, 8)}:`,
    ).toEqual([]);
  });

  it("migração sem correção posterior é idêntica ao commit que a criou", () => {
    const drifted: string[] = [];

    for (const file of baselineMigrations()) {
      const commits = git(["log", "--format=%H", BASELINE, "--", file])
        .split("\n")
        .filter((line) => line !== "");

      // Arquivo corrigido por ADR posterior à criação: a comparação válida é a da base do range,
      // já coberta pelo caso acima. Aqui entram só os que nunca foram tocados de novo.
      if (commits.length !== 1) continue;

      const creation = commits[0];
      if (creation === undefined) continue;
      const diff = git(["diff", "--name-status", creation, "--", file]).trim();
      if (diff !== "") drifted.push(`${file} desde ${creation.slice(0, 8)}: ${diff}`);
    }

    expect(drifted, "Migração alterada depois do commit de criação:").toEqual([]);
  });
});
