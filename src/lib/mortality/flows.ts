import type { CauseLevel } from "./cause-level";
import { indexOf } from "./dimensions";
import type { Dimensions, FlowRow, FlowsMeta, Sex } from "./types";

export interface FlowPair {
  origin: number;
  destination: number;
  deaths: number;
}

const SEX_CODES: Record<Sex, number | null> = {
  Ambos: null,
  Homens: 0,
  Mulheres: 1,
};

function rowMatcher(
  level: CauseLevel,
  dimensions: Dimensions,
): (row: FlowRow) => boolean {
  if (level.kind === "overall") return () => true;
  if (level.kind === "cause_group") {
    const index = indexOf(dimensions.cause_groups, level.causeGroup);
    return (row) => row[3] === index;
  }
  if (level.kind === "detailed_subgroup") {
    const index = indexOf(
      dimensions.detailed_subgroups,
      level.detailedSubgroup,
    );
    return (row) => row[4] === index;
  }
  if (level.kind === "external_cause") {
    const index = indexOf(
      dimensions.external_cause_types,
      level.externalCauseType,
    );
    return (row) => row[5] === index;
  }
  const index = indexOf(dimensions.assault_means, level.assaultMeans);
  return (row) => row[6] === index;
}

export function aggregateFlows(
  rows: FlowRow[],
  level: CauseLevel,
  sex: Sex,
  dimensions: Dimensions,
  endpointCount: number,
): FlowPair[] {
  const matches = rowMatcher(level, dimensions);
  const sexCode = SEX_CODES[sex];
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (sexCode !== null && row[2] !== sexCode) continue;
    if (!matches(row)) continue;
    const key = row[0] * endpointCount + row[1];
    totals.set(key, (totals.get(key) ?? 0) + row[7]);
  }
  return [...totals].map(([key, deaths]) => ({
    origin: Math.floor(key / endpointCount),
    destination: key % endpointCount,
    deaths,
  }));
}

export type EndpointKind = "municipality" | "state-unknown" | "other-state";

export function endpointKind(meta: FlowsMeta, index: number): EndpointKind {
  if (index < meta.municipality_count) return "municipality";
  if (index === meta.municipality_count) return "state-unknown";
  return "other-state";
}

export function isInsideState(meta: FlowsMeta, index: number): boolean {
  return index <= meta.municipality_count;
}
