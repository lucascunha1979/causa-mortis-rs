import type { CauseFilter, Dimensions, Filters, Sex } from "./types";

export interface ChartTitle {
  line1: string;
  line2: string;
}

const SAME_LINE_TOLERANCE = 8;

const observedTitles = new WeakSet<Element>();

function syncTitleSeparator(titleEl: Element): void {
  const line1El = titleEl.querySelector("[data-chart-title-line1]");
  const line2El = titleEl.querySelector("[data-chart-title-line2]");
  if (!(line1El instanceof HTMLElement) || !(line2El instanceof HTMLElement))
    return;

  const line1Rects = line1El.getClientRects();
  const lastLine1 = line1Rects[line1Rects.length - 1];
  const sameLine =
    lastLine1 !== undefined &&
    Math.abs(lastLine1.top - line2El.getBoundingClientRect().top) <
      SAME_LINE_TOLERANCE;
  line2El.toggleAttribute("data-stacked", !sameLine);
}

function observeTitleWidth(titleEl: Element): void {
  if (observedTitles.has(titleEl)) return;
  observedTitles.add(titleEl);
  const card = titleEl.closest(".chart-card");
  if (!card) return;

  let observedWidth = 0;
  new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (width === observedWidth) return;
    observedWidth = width;
    syncTitleSeparator(titleEl);
  }).observe(card);
}

export function setChartTitle(
  titleEl: Element | null,
  title: ChartTitle,
): void {
  if (!titleEl) return;
  const line1El = titleEl.querySelector("[data-chart-title-line1]");
  const line2El = titleEl.querySelector("[data-chart-title-line2]");
  if (line1El) line1El.textContent = title.line1;
  if (line2El) line2El.textContent = title.line2;
  syncTitleSeparator(titleEl);
  observeTitleWidth(titleEl);
  titleEl.dispatchEvent(
    new CustomEvent("chart-title-change", { bubbles: true }),
  );
}

export function causePathLabel(filters: CauseFilter): string {
  const parts = [
    filters.causeGroup,
    filters.detailedSubgroup ?? filters.externalCauseType,
    filters.assaultMeans,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : "Todas as causas";
}

export function sexLabel(sex: Sex): string {
  if (sex === "Homens") return "Homens";
  if (sex === "Mulheres") return "Mulheres";
  return "Todos";
}

export function placeLabel(filters: Filters): string {
  return filters.place === "ocor" ? "Por ocorrência" : "Por residência";
}

export function yearLabel(year: number, dimensions: Dimensions): string {
  const maxYear = Math.max(...dimensions.years);
  return year === maxYear ? `${year} (preliminar)` : String(year);
}

export function locationLabel(
  dimensions: Dimensions,
  location: string,
): string {
  return dimensions.location_names[location] ?? location;
}

export function mapChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: `Mortalidade por município - ${causePathLabel(filters)}`,
    line2: `${yearLabel(filters.year, dimensions)} · ${sexLabel(filters.sex)} · ${placeLabel(filters)}`,
  };
}

export function evolutionChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: `Histórico de mortalidade - ${causePathLabel(filters)}`,
    line2: `${filters.yearStart}-${filters.yearEnd} · ${sexLabel(filters.sex)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function causesChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: `Composição da mortalidade - ${causePathLabel(filters)}`,
    line2: `${yearLabel(filters.year, dimensions)} · ${sexLabel(filters.sex)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function statsChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): string {
  return `Resumo · ${yearLabel(filters.year, dimensions)} · ${placeLabel(filters).toLowerCase()}`;
}

export function flowsChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: `Fluxos residência → ocorrência - ${causePathLabel(filters)}`,
    line2: `${yearLabel(filters.year, dimensions)} · ${sexLabel(filters.sex)} · ${locationLabel(dimensions, filters.location)}`,
  };
}

export function ageCompositionChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: "Composição da mortalidade por faixa etária",
    line2: `${yearLabel(filters.year, dimensions)} · ${sexLabel(filters.sex)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function qualityChartTitle(): ChartTitle {
  return {
    line1: "Cobertura do SIM no Rio Grande do Sul",
    line2: "",
  };
}

export function pyramidChartTitle(
  filters: Filters,
  dimensions: Dimensions,
): ChartTitle {
  return {
    line1: `Pirâmide de mortalidade - ${causePathLabel(filters)}`,
    line2: `${yearLabel(filters.year, dimensions)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function ageProfileChartTitle(
  filters: Filters,
  dimensions: Dimensions,
  bandName: string,
): ChartTitle {
  return {
    line1: `Mortalidade na faixa de ${bandName} - ${causePathLabel(filters)}`,
    line2: `${yearLabel(filters.year, dimensions)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function ageEvolutionChartTitle(
  filters: Filters,
  dimensions: Dimensions,
  bandName: string,
): ChartTitle {
  return {
    line1: `Evolução na faixa de ${bandName} - ${causePathLabel(filters)}`,
    line2: `${Math.min(...dimensions.years)}-${Math.max(...dimensions.years)} · ${locationLabel(dimensions, filters.location)} · ${placeLabel(filters)}`,
  };
}

export function smrChartTitle(
  filters: Filters,
  periodLabel: string,
): ChartTitle {
  return {
    line1: `Mortalidade observada × esperada - ${causePathLabel(filters)}`,
    line2: `${periodLabel} · ${sexLabel(filters.sex)} · ${placeLabel(filters)}`,
  };
}
