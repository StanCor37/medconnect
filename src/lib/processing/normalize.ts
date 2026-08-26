import type { Prisma } from "@/generated/prisma/client";
import type { ExtractionValueType } from "@/generated/prisma/enums";
import { normalizeDateValue, normalizeMoneyMinorUnits, normalizeNameValue } from "@/lib/rules/evaluateDeterministicRule";

function normalizeNumberValue(v: string): number | null {
  const num = Number(v.replace(/,/g, "").trim());
  return Number.isNaN(num) ? null : num;
}

function normalizeBooleanValue(v: string): boolean | null {
  if (/^(yes|true|da)$/i.test(v.trim())) return true;
  if (/^(no|false|ne)$/i.test(v.trim())) return false;
  return null;
}

/** Preserves case and leading zeros — deliberately no case-folding, unlike normalizeNameValue (spec §14). */
function normalizeIdentifierValue(v: string): string | null {
  const trimmed = v.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

function sniffCurrency(raw: string): string | null {
  if (/RSD|din\.?/i.test(raw)) return "RSD";
  if (/EUR|€/i.test(raw)) return "EUR";
  return null;
}

/**
 * All of this pipeline's date extraction hints are written to capture
 * dot-separated `dd.mm.yyyy` (the region's convention, matching the source
 * documents this pipeline actually processes) — JS `new Date(...)` parses a
 * dotted string as month-first and can also shift a day via UTC conversion,
 * which is exactly the "guess day and month silently" spec §14 forbids.
 * Parsed explicitly here instead of delegating to the generic
 * normalizeDateValue, which is tuned for rule-evaluation inputs, not
 * label-adjacent extracted text.
 */
function normalizeExtractedDate(v: string): string | null {
  const match = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return normalizeDateValue(v);
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export interface NormalizationResult {
  normalizedValue: Prisma.InputJsonValue | null;
  ok: boolean;
}

/**
 * `ExtractionValueType`'s money case reuses normalizeMoneyMinorUnits
 * directly from evaluateDeterministicRule.ts — a generic (v: unknown) => X |
 * null helper with no rule-evaluation coupling. Dates go through
 * normalizeExtractedDate above instead of normalizeDateValue directly (see
 * its comment for why).
 */
export function normalizeExtractedValue(raw: string, valueType: ExtractionValueType): NormalizationResult {
  const trimmed = raw.trim();
  switch (valueType) {
    case "string":
    case "code":
      return { normalizedValue: trimmed || null, ok: trimmed.length > 0 };
    case "identifier": {
      const value = normalizeIdentifierValue(trimmed);
      return { normalizedValue: value, ok: value !== null };
    }
    case "date": {
      const value = normalizeExtractedDate(trimmed);
      return { normalizedValue: value, ok: value !== null };
    }
    case "number": {
      const value = normalizeNumberValue(trimmed);
      return { normalizedValue: value, ok: value !== null };
    }
    case "boolean": {
      const value = normalizeBooleanValue(trimmed);
      return { normalizedValue: value, ok: value !== null };
    }
    case "money": {
      // rawValue may include a trailing currency label (e.g. "90.00 EUR") —
      // normalizeMoneyMinorUnits only understands a bare number, so isolate
      // the numeric portion first and sniff currency from the full string.
      const numericMatch = trimmed.match(/[0-9][0-9.,]*/);
      const minorUnits = numericMatch ? normalizeMoneyMinorUnits(numericMatch[0]) : null;
      if (minorUnits === null) return { normalizedValue: null, ok: false };
      return { normalizedValue: { minorUnits, currency: sniffCurrency(trimmed) }, ok: true };
    }
    default:
      return { normalizedValue: null, ok: false };
  }
}

export { normalizeNameValue };
