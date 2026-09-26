import type { CauseLevel } from "./cause-level";
import {
  fetchSmrByAssaultMeans,
  fetchSmrByCauseGroup,
  fetchSmrByDetailedSubgroup,
  fetchSmrByExternalCause,
  fetchSmrOverall,
} from "./data";
import { indexOf } from "./dimensions";
import type { Dimensions, SmrEntry } from "./types";

const Z_95 = 1.959964;

export type SmrGetter = (
  locationIndex: number,
  sexIndex: number,
  yearIndex: number,
) => SmrEntry | null;

export type SmrClass =
  "above-significant" | "above" | "below" | "below-significant" | "no-data";

export interface SmrResult {
  observed: number;
  expected: number;
  ratio: number;
  lower: number;
  upper: number;
  smrClass: SmrClass;
}

export async function loadSmrGetter(
  level: CauseLevel,
  dimensions: Dimensions,
): Promise<SmrGetter> {
  if (level.kind === "overall") {
    const table = await fetchSmrOverall();
    return (li, si, yi) => table[li]?.[si]?.[yi] ?? null;
  }
  const [table, index] =
    level.kind === "cause_group"
      ? [
          await fetchSmrByCauseGroup(),
          indexOf(dimensions.cause_groups, level.causeGroup),
        ]
      : level.kind === "detailed_subgroup"
        ? [
            await fetchSmrByDetailedSubgroup(),
            indexOf(dimensions.detailed_subgroups, level.detailedSubgroup),
          ]
        : level.kind === "external_cause"
          ? [
              await fetchSmrByExternalCause(),
              indexOf(dimensions.external_cause_types, level.externalCauseType),
            ]
          : [
              await fetchSmrByAssaultMeans(),
              indexOf(dimensions.assault_means, level.assaultMeans),
            ];
  return (li, si, yi) => table[li]?.[si]?.[yi]?.[index] ?? null;
}

function byarLower(observed: number): number {
  if (observed === 0) return 0;
  return (
    observed * (1 - 1 / (9 * observed) - Z_95 / (3 * Math.sqrt(observed))) ** 3
  );
}

function byarUpper(observed: number): number {
  const next = observed + 1;
  return next * (1 - 1 / (9 * next) + Z_95 / (3 * Math.sqrt(next))) ** 3;
}

export function smrForPeriod(
  getter: SmrGetter,
  locationIndex: number,
  sexIndex: number,
  yearIndices: number[],
): SmrResult | null {
  let observed = 0;
  let expected = 0;
  let found = false;
  for (const yearIndex of yearIndices) {
    const entry = getter(locationIndex, sexIndex, yearIndex);
    if (!entry) continue;
    found = true;
    observed += entry[0];
    expected += entry[1];
  }
  if (!found) return null;
  if (expected <= 0)
    return {
      observed,
      expected,
      ratio: 0,
      lower: 0,
      upper: 0,
      smrClass: "no-data",
    };
  const ratio = observed / expected;
  const lower = byarLower(observed) / expected;
  const upper = byarUpper(observed) / expected;
  const smrClass: SmrClass =
    lower > 1
      ? "above-significant"
      : upper < 1
        ? "below-significant"
        : ratio >= 1
          ? "above"
          : "below";
  return { observed, expected, ratio, lower, upper, smrClass };
}

export function periodYearIndices(
  dimensions: Dimensions,
  endYear: number,
  length: number,
): number[] {
  const endIndex = indexOf(dimensions.years, endYear);
  const startIndex = Math.max(0, endIndex - length + 1);
  return Array.from(
    { length: endIndex - startIndex + 1 },
    (_, i) => startIndex + i,
  );
}

export const SMR_CLASS_LABELS: Record<SmrClass, string> = {
  "above-significant": "Acima do esperado (significativo)",
  above: "Acima do esperado (sem significância)",
  below: "Abaixo do esperado (sem significância)",
  "below-significant": "Abaixo do esperado (significativo)",
  "no-data": "Sem dado ou nenhum óbito esperado",
};

export const SMR_CLASS_ORDER: SmrClass[] = [
  "above-significant",
  "above",
  "below",
  "below-significant",
  "no-data",
];
