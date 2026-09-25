import type { Dimensions } from "./types";

export interface AgeBand {
  id: string;
  label: string;
  name: string;
  indices: number[];
}

const BROAD_BANDS: {
  id: string;
  label: string;
  first: string;
  last: string;
}[] = [
  { id: "1-14", label: "1 a 14 anos", first: "1-4", last: "10-14" },
  { id: "15-29", label: "15 a 29 anos", first: "15-19", last: "25-29" },
  { id: "30-59", label: "30 a 59 anos", first: "30-34", last: "55-59" },
  { id: "60-79", label: "60 a 79 anos", first: "60-64", last: "75-79" },
];

export const DEFAULT_AGE_BAND = "30-59";

function singleBandLabel(ageGroup: string): string {
  if (ageGroup.startsWith("<")) return `Menos de ${ageGroup.slice(1)} ano`;
  if (ageGroup.endsWith("+")) return `${ageGroup.slice(0, -1)} anos ou mais`;
  return `${ageGroup.replace("-", " a ")} anos`;
}

export function ageBands(dimensions: Dimensions): AgeBand[] {
  const singles = dimensions.age_groups.map((ageGroup, index) => {
    const label = singleBandLabel(ageGroup);
    return { id: ageGroup, label, name: label, indices: [index] };
  });
  const broad = BROAD_BANDS.map(({ id, label, first, last }) => {
    const start = dimensions.age_groups.indexOf(first);
    const end = dimensions.age_groups.indexOf(last);
    return {
      id,
      label: `${label} (grupo)`,
      name: label,
      indices: Array.from({ length: end - start + 1 }, (_, i) => start + i),
    };
  });
  return [...broad, ...singles];
}

export function findAgeBand(dimensions: Dimensions, id: string): AgeBand {
  const bands = ageBands(dimensions);
  const band =
    bands.find((candidate) => candidate.id === id) ??
    bands.find((candidate) => candidate.id === DEFAULT_AGE_BAND);
  if (!band) throw new Error(`Faixa etária "${id}" não encontrada.`);
  return band;
}
