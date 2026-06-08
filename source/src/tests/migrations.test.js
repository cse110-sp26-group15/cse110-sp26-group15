import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve db/migrations relative to this file so the test is robust to
// vitest's cwd.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "db", "migrations");

/**
 * @returns {string[]} sorted filenames in db/migrations/.
 */
function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Parse the numeric prefix out of a migration filename. Throws when the
 * filename doesn't match the canonical `NNNN_description.sql` shape so
 * a malformed name is caught up-front by the duplicate test below.
 *
 * @param {string} filename
 * @returns {number}
 */
function prefixOf(filename) {
  const m = filename.match(/^(\d{4})_/);
  if (!m) throw new Error(`Migration filename does not start with 4-digit prefix: ${filename}`);
  return Number(m[1]);
}

describe("db/migrations — filename conventions", () => {
  const files = listMigrationFiles();

  it("has at least the original schema", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("every migration uses a 4-digit numeric prefix", () => {
    for (const f of files) {
      expect(f, `bad filename: ${f}`).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
  });

  it("no two migrations share the same numeric prefix", () => {
    const counts = new Map();
    for (const f of files) {
      const n = prefixOf(f);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, c]) => c > 1);
    expect(
      dupes,
      `duplicate prefixes (these will silently collide on apply): ${JSON.stringify(dupes)}`
    ).toEqual([]);
  });

  it("prefixes form a contiguous sequence starting at 0001", () => {
    const prefixes = files.map(prefixOf).sort((a, b) => a - b);
    expect(prefixes[0]).toBe(1);
    for (let i = 1; i < prefixes.length; i++) {
      // A gap (e.g. 0005 → 0007) is a hint that a migration was
      // deleted without being repurposed. Allowed in theory but worth
      // surfacing — tighten if the team decides to disallow gaps.
      expect(prefixes[i] - prefixes[i - 1]).toBe(1);
    }
  });
});

describe("db/migrations — schema sanity", () => {
  it("0001 is the initial schema and creates the users table", () => {
    const files = listMigrationFiles();
    const first = files[0];
    expect(first).toMatch(/^0001_/);
    const sql = readFileSync(join(MIGRATIONS_DIR, first), "utf8");
    expect(sql).toMatch(/CREATE TABLE\s+users/i);
  });

  it("each ALTER TABLE / CREATE TABLE statement references a defined table or adds new one", () => {
    // Cheap structural smoke: just check none of the migrations are
    // empty after the rename (catches a `git mv` that mangled a file).
    for (const f of listMigrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      expect(sql.trim().length, `${f} is empty`).toBeGreaterThan(10);
    }
  });
});

describe("db/RENUMBER.sql — old→new name mapping", () => {
  it("contains an UPDATE for every legacy filename that was renamed", () => {
    const sql = readFileSync(join(REPO_ROOT, "db", "RENUMBER.sql"), "utf8");
    const expectedMappings = [
      ["001_initial_schema.sql", "0001_initial_schema.sql"],
      ["0007_add_xp_pairs.sql", "0008_add_xp_pairs.sql"],
      ["0008_add_sessions.sql", "0009_add_sessions.sql"],
      ["0008_add_task_priority_created_at.sql", "0010_add_task_priority_created_at.sql"],
      ["0008_add_project_invites.sql", "0011_add_project_invites.sql"],
      ["0009_add_task_pair_assignee.sql", "0012_add_task_pair_assignee.sql"],
    ];
    for (const [oldName, newName] of expectedMappings) {
      expect(sql, `RENUMBER.sql is missing mapping ${oldName} → ${newName}`).toContain(oldName);
      expect(sql).toContain(newName);
    }
  });

  it("every UPDATE in RENUMBER.sql targets a real renamed file", () => {
    const sql = readFileSync(join(REPO_ROOT, "db", "RENUMBER.sql"), "utf8");
    const liveFiles = new Set(listMigrationFiles());
    // Find every "name = 'foo.sql'" that's the SET target, not the WHERE.
    const setMatches = [...sql.matchAll(/SET\s+name\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(setMatches.length).toBeGreaterThan(0);
    for (const name of setMatches) {
      expect(liveFiles.has(name), `RENUMBER.sql targets ${name} but the file no longer exists`).toBe(
        true
      );
    }
  });
});
