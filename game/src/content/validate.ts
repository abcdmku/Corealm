/**
 * Content validation.
 *
 * Canonical content is authored by hand across many files, and a typo in a recipe's ingredient id or
 * a quest's reward item is invisible until it breaks a player mid-session. So content is validated
 * once at boot, loudly, and a failure is fatal rather than silently degrading.
 *
 * Validation is also what keeps the generated documentation honest: docs are derived from the same
 * tables, so if the tables are self-consistent the docs cannot drift from the game.
 *
 * FROZEN. Only the root edits this file.
 */
import type { ItemId, RecipeId, SkillId, EntityId, QuestId, RegionId } from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { MAX_LEVEL } from "./xp.js";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Which table the problem is in, e.g. "recipes" or "quests". */
  table: string;
  /** The offending row's id, when there is one. */
  id: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  counts: Record<string, number>;
}

/**
 * Collects issues while walking content tables.
 *
 * Deliberately accumulating rather than fail-fast: one run should report every problem in the
 * content set, not the first. Fixing content one error per boot cycle is miserable.
 */
export class ContentValidator {
  private issues: ValidationIssue[] = [];
  private counts: Record<string, number> = {};

  /** Records how many rows a table contributed, for the boot log and the docs. */
  count(table: string, rows: number): void {
    this.counts[table] = rows;
  }

  error(table: string, id: string, message: string): void {
    this.issues.push({ severity: "error", table, id, message });
  }

  warn(table: string, id: string, message: string): void {
    this.issues.push({ severity: "warning", table, id, message });
  }

  /** Asserts a condition, recording an error when it fails. Returns the condition. */
  check(condition: boolean, table: string, id: string, message: string): boolean {
    if (!condition) this.error(table, id, message);
    return condition;
  }

  /** Every id in a table must be unique; a duplicate silently shadows a row. */
  uniqueIds(table: string, ids: readonly string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) this.error(table, id, `Duplicate id "${id}"`);
      seen.add(id);
    }
  }

  /** A cross-table reference must resolve, e.g. a recipe ingredient must be a real item. */
  reference(table: string, id: string, field: string, value: string | undefined, pool: ReadonlySet<string>): void {
    if (value === undefined) return;
    if (!pool.has(value)) this.error(table, id, `${field} references unknown "${value}"`);
  }

  references(table: string, id: string, field: string, values: readonly string[], pool: ReadonlySet<string>): void {
    for (const value of values) this.reference(table, id, field, value, pool);
  }

  /** Skill requirement maps must name real skills and stay inside 1..99. */
  requirements(table: string, id: string, requirements: Partial<Record<SkillId, number>> | undefined): void {
    if (!requirements) return;
    for (const [skill, level] of Object.entries(requirements)) {
      if (!SKILL_IDS.includes(skill as SkillId)) {
        this.error(table, id, `Requirement names unknown skill "${skill}"`);
        continue;
      }
      if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
        this.error(table, id, `Requirement ${skill} must be an integer 1..${MAX_LEVEL}, got ${String(level)}`);
      }
    }
  }

  /** Content tiers are meaningful only at the twelve authored steps. */
  tier(table: string, id: string, tier: number): void {
    if (!Number.isInteger(tier) || tier < 1 || tier > MAX_LEVEL) {
      this.error(table, id, `Tier must be an integer 1..${MAX_LEVEL}, got ${tier}`);
    }
  }

  finite(table: string, id: string, field: string, value: number): void {
    if (!Number.isFinite(value)) this.error(table, id, `${field} must be finite, got ${String(value)}`);
  }

  positive(table: string, id: string, field: string, value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      this.error(table, id, `${field} must be greater than zero, got ${String(value)}`);
    }
  }

  /** An entity's world position must be a finite 3-tuple. */
  position(table: string, id: string, position: readonly number[]): void {
    if (position.length !== 3 || !position.every((value) => Number.isFinite(value))) {
      this.error(table, id, `Position must be three finite numbers, got [${position.join(", ")}]`);
    }
  }

  report(): ValidationReport {
    const errors = this.issues.filter((issue) => issue.severity === "error");
    const warnings = this.issues.filter((issue) => issue.severity === "warning");
    return { ok: errors.length === 0, errors, warnings, counts: { ...this.counts } };
  }

  reset(): void {
    this.issues = [];
    this.counts = {};
  }
}

/** Human-readable summary for the boot log and `getErrors()`. */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  const total = Object.values(report.counts).reduce((sum, value) => sum + value, 0);
  lines.push(`Content: ${total} rows across ${Object.keys(report.counts).length} tables`);
  for (const issue of [...report.errors, ...report.warnings]) {
    lines.push(`  [${issue.severity}] ${issue.table}/${issue.id}: ${issue.message}`);
  }
  return lines.join("\n");
}

/** Convenience id-pool builder for cross-reference checks. */
export function idPool<T extends { id: string }>(rows: readonly T[]): ReadonlySet<string> {
  return new Set(rows.map((row) => row.id));
}

export type ContentId = ItemId | RecipeId | EntityId | QuestId | RegionId;
