import { getAgeSeries } from "./access";
import { findAgeBand, type AgeBand } from "./age-bands";
import {
  loadDeathsByAgeGetter,
  resolveCauseLevel,
  type AgeSeriesGetter,
  type CauseLevel,
} from "./cause-level";
import {
  fetchDeathsByCauseGroupForLocation,
  fetchDeathsByDetailedSubgroupForLocation,
  fetchOverallForLocation,
  fetchPopulationByAgeForLocation,
} from "./data";
import { causeGroupsForDetail, indexOf } from "./dimensions";
import { crudeRate } from "./rate";
import type {
  AgeMeasure,
  AgeSeries,
  CauseFilter,
  Dimensions,
  Filters,
  Sex,
} from "./types";

export const AGE_PROFILE_SEXES: Sex[] = ["Homens", "Mulheres", "Ambos"];

export interface AgeCause {
  label: string;
  level: CauseLevel;
}

export interface AgeCell {
  deaths: number;
  rate: number;
  share: number;
}

type CellGetter = (sexIndex: number, yearIndex: number) => AgeCell | null;
type PresenceGetter = (sexIndex: number, yearIndex: number) => boolean;

export interface AgeProfile {
  band: AgeBand;
  causes: AgeCause[];
  causeCell: (
    causeIndex: number,
    sexIndex: number,
    yearIndex: number,
  ) => AgeCell | null;
  selectedCell: CellGetter;
  locationExists: PresenceGetter;
}

export function ageCauses(
  filters: CauseFilter,
  dimensions: Dimensions,
): AgeCause[] {
  const { causeGroup, detailedSubgroup, externalCauseType, assaultMeans } =
    filters;
  const selected = resolveCauseLevel(filters);

  if (!causeGroup)
    return dimensions.cause_groups.map((group) => ({
      label: group,
      level: { kind: "cause_group", causeGroup: group },
    }));

  const leaf = assaultMeans ?? detailedSubgroup;
  if (leaf) return [{ label: leaf, level: selected }];

  if (externalCauseType) {
    if (externalCauseType !== "Agressão")
      return [{ label: externalCauseType, level: selected }];
    return dimensions.assault_means.map((means) => ({
      label: means,
      level: {
        kind: "assault_means",
        causeGroup,
        externalCauseType,
        assaultMeans: means,
      },
    }));
  }

  const detailIndices = causeGroupsForDetail(
    dimensions,
    dimensions.cause_groups.indexOf(causeGroup),
  );
  if (detailIndices.length > 0)
    return detailIndices.flatMap((detailIndex) => {
      const subgroup = dimensions.detailed_subgroups[detailIndex];
      return subgroup
        ? [
            {
              label: subgroup,
              level: {
                kind: "detailed_subgroup" as const,
                causeGroup,
                detailedSubgroup: subgroup,
              },
            },
          ]
        : [];
    });

  if (causeGroup === "Causas externas")
    return dimensions.external_cause_types.map((type) => ({
      label: type,
      level: { kind: "external_cause", causeGroup, externalCauseType: type },
    }));

  return [{ label: causeGroup, level: selected }];
}

async function loadPresence(
  level: CauseLevel,
  dimensions: Dimensions,
  location: string,
): Promise<PresenceGetter> {
  if (level.kind === "cause_group") {
    const causeGroupIndex = indexOf(dimensions.cause_groups, level.causeGroup);
    const table = await fetchDeathsByCauseGroupForLocation(location);
    return (si, yi) => table[si]?.[yi]?.[causeGroupIndex] != null;
  }
  if (level.kind === "detailed_subgroup") {
    const subgroupIndex = indexOf(
      dimensions.detailed_subgroups,
      level.detailedSubgroup,
    );
    const table = await fetchDeathsByDetailedSubgroupForLocation(location);
    return (si, yi) => table[si]?.[yi]?.[subgroupIndex] != null;
  }
  return () => true;
}

function sumBand(series: AgeSeries | null, band: AgeBand): number {
  return band.indices.reduce((sum, index) => sum + (series?.[index] ?? 0), 0);
}

export async function loadAgeProfile(
  filters: Filters,
  dimensions: Dimensions,
): Promise<AgeProfile> {
  const band = findAgeBand(dimensions, filters.ageBand);
  const causes = ageCauses(filters, dimensions);
  const selectedLevel = resolveCauseLevel(filters);
  const location = filters.location;

  const [
    overallTable,
    populationTable,
    allCausesGetter,
    selectedGetter,
    selectedPresence,
    causeGetters,
    causePresences,
  ] = await Promise.all([
    fetchOverallForLocation(location),
    fetchPopulationByAgeForLocation(location),
    loadDeathsByAgeGetter({ kind: "overall" }, dimensions, location),
    loadDeathsByAgeGetter(selectedLevel, dimensions, location),
    loadPresence(selectedLevel, dimensions, location),
    Promise.all(
      causes.map((cause) =>
        loadDeathsByAgeGetter(cause.level, dimensions, location),
      ),
    ),
    Promise.all(
      causes.map((cause) => loadPresence(cause.level, dimensions, location)),
    ),
  ]);

  const locationExists: PresenceGetter = (si, yi) =>
    overallTable[si]?.[yi] != null;

  function cellFrom(
    getter: AgeSeriesGetter,
    presence: PresenceGetter,
  ): CellGetter {
    return (si, yi) => {
      if (!locationExists(si, yi) || !presence(si, yi)) return null;
      const deaths = sumBand(getter(si, yi), band);
      const population = sumBand(getAgeSeries(populationTable, si, yi), band);
      const allDeaths = sumBand(allCausesGetter(si, yi), band);
      return {
        deaths,
        rate: crudeRate(deaths, population),
        share: allDeaths > 0 ? deaths / allDeaths : 0,
      };
    };
  }

  const causeCells = causes.map((_, index) =>
    cellFrom(
      causeGetters[index] ?? allCausesGetter,
      causePresences[index] ?? (() => false),
    ),
  );

  return {
    band,
    causes,
    causeCell: (causeIndex, si, yi) => causeCells[causeIndex]?.(si, yi) ?? null,
    selectedCell: cellFrom(selectedGetter, selectedPresence),
    locationExists,
  };
}

export function measureValue(cell: AgeCell, measure: AgeMeasure): number {
  if (measure === "deaths") return cell.deaths;
  if (measure === "rate") return cell.rate;
  return cell.share * 100;
}

export function measureLabel(measure: AgeMeasure): string {
  if (measure === "deaths") return "Óbitos com idade informada";
  if (measure === "rate") return "Taxa por 100 mil habitantes da faixa";
  return "% dos óbitos da faixa (todas as causas = 100%)";
}
