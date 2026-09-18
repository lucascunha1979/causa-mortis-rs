import { loadRatePointGetter, resolveCauseLevel } from "../cause-level";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  roundTo,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import { mapChartTitle, setChartTitle } from "../chart-titles";
import { fetchMunicipalitiesGeoJson, fetchOverall } from "../data";
import { indexOf } from "../dimensions";
import { MapChart } from "echarts/charts";
import { TooltipComponent, VisualMapComponent } from "echarts/components";
import type { EChartsOption, TopLevelFormatterParams } from "../echarts-core";
import { echarts } from "../echarts-core";
import { formatInteger, formatRate } from "../format";
import { JENKS_CLASSES, jenksBreaks } from "../jenks";
import {
  chartSurfaceColor,
  mapScaleSteps,
  noDataColor,
  themeColor,
  tooltipStyle,
} from "../palette";
import { isManualYearOnlyChange, type FiltersStore } from "../filters";
import { setupChartShare } from "../share";
import type { Dimensions, Filters } from "../types";

echarts.use([MapChart, TooltipComponent, VisualMapComponent]);

const MAP_NAME = "rs-municipalities";
const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 620 };

interface MapEntry {
  name: string;
  value: number;
  deaths: number;
}

interface MapOptionData {
  data: MapEntry[];
  breaks: number[];
}

function pieces(breaks: number[]): { min: number; max: number }[] {
  const result: { min: number; max: number }[] = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const min = breaks[i] ?? 0;
    const max = breaks[i + 1] ?? min;
    result.push({ min, max });
  }
  return result;
}

export function init(
  container: HTMLElement,
  store: FiltersStore,
  dimensions: Dimensions,
): void {
  const chart = echarts.init(container);
  new ResizeObserver(() => chart.resize()).observe(container);

  const card = container.closest(".chart-card") ?? document;
  const titleEl = card.querySelector("[data-chart-title]");
  const subtitleEl = card.querySelector("[data-chart-subtitle]");
  const stableScaleCheckbox = card.querySelector("#map-scale-stable");

  if (subtitleEl)
    subtitleEl.textContent =
      "Taxa/100 mil habitantes (padronizada por idade) · classes por quebras naturais de Jenks";

  let stableScale = false;
  let mapRegistered = false;
  let renderToken = 0;
  let previousFilters: Filters | null = null;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  if (stableScaleCheckbox instanceof HTMLInputElement) {
    stableScaleCheckbox.addEventListener("change", () => {
      stableScale = stableScaleCheckbox.checked;
      void render();
    });
  }

  const municipalityLocations = dimensions.locations.filter(
    (location) => location !== "RS",
  );

  let lastOptionData: MapOptionData | null = null;

  function buildOption(
    optionData: MapOptionData,
    useFastAnimation: boolean,
    forceLight = false,
  ): EChartsOption {
    const { data, breaks } = optionData;
    const colors = mapScaleSteps("rate", { forceLight });
    const classPieces = pieces(breaks);
    const step = (colors.length - 1) / Math.max(classPieces.length - 1, 1);
    const byName = new Map(data.map((entry) => [entry.name, entry]));
    return {
      tooltip: {
        formatter: (raw: TopLevelFormatterParams) => {
          const params = Array.isArray(raw) ? raw[0] : raw;
          if (!params) return "";
          const { name } = params;
          const entry = byName.get(name);
          const label = `${dimensions.location_names[name] ?? name} (${name})`;
          if (!entry) return `${label}<br/>sem dado`;
          return `${label}<br/>${formatRate(entry.value)} por 100 mil hab. (padronizada por idade)<br/>${formatInteger(entry.deaths)} óbitos`;
        },
        ...tooltipStyle(),
      },
      visualMap: {
        type: "piecewise",
        pieces: classPieces.map((piece, index) => ({
          min: piece.min,
          max: piece.max,
          label: `${formatRate(piece.min)} – ${formatRate(piece.max)}`,
          color: colors[Math.round(index * step)] ?? colors[0],
        })),
        inverse: true,
        orient: "vertical",
        left: "left",
        bottom: 0,
        itemGap: 4,
        textStyle: { color: themeColor("--color-gray-600", { forceLight }) },
      },
      series: [
        {
          type: "map",
          map: MAP_NAME,
          aspectScale: 0.95,
          layoutCenter: ["55%", "50%"],
          layoutSize: "95%",
          roam: false,
          ...(useFastAnimation ? { animationDurationUpdate: 200 } : {}),
          itemStyle: {
            areaColor: noDataColor({ forceLight }),
            borderColor: chartSurfaceColor({ forceLight }),
            borderWidth: 0.4,
          },
          emphasis: {
            label: { show: false },
            itemStyle: {
              borderColor: themeColor("--color-rate-500", { forceLight }),
              borderWidth: 1.5,
            },
          },
          select: { disabled: true },
          label: { show: false },
          data: data.map((entry) => ({ name: entry.name, value: entry.value })),
        },
      ],
    };
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const level = resolveCauseLevel(filters);
    const useFastAnimation = isManualYearOnlyChange(
      store.getLastYearOrigin(),
      previousFilters,
      filters,
    );
    previousFilters = filters;

    const geoJson = await fetchMunicipalitiesGeoJson();
    if (!mapRegistered) {
      echarts.registerMap(
        MAP_NAME,
        geoJson as Parameters<typeof echarts.registerMap>[1],
      );
      mapRegistered = true;
    }

    const [pointGetter, overallTable] = await Promise.all([
      loadRatePointGetter(level, dimensions),
      fetchOverall(),
    ]);
    if (token !== renderToken) return;

    setChartTitle(titleEl, mapChartTitle(filters, dimensions));

    const sexIndex = indexOf(dimensions.sexes, filters.sex);
    const yearIndex = indexOf(dimensions.years, filters.year);
    const yearIndicesForDomain = stableScale
      ? dimensions.years.map((_, i) => i)
      : [yearIndex];

    const hasData = (locationIndex: number, yi: number): boolean =>
      overallTable[locationIndex]?.[sexIndex]?.[yi] != null;

    const domainValues: number[] = [];
    for (const location of municipalityLocations) {
      const locationIndex = indexOf(dimensions.locations, location);
      for (const yi of yearIndicesForDomain) {
        if (hasData(locationIndex, yi))
          domainValues.push(pointGetter(locationIndex, sexIndex, yi).stdRate);
      }
    }
    const breaks = jenksBreaks(domainValues, JENKS_CLASSES);

    const data: MapEntry[] = [];
    for (const location of municipalityLocations) {
      const locationIndex = indexOf(dimensions.locations, location);
      if (!hasData(locationIndex, yearIndex)) continue;
      const point = pointGetter(locationIndex, sexIndex, yearIndex);
      data.push({ name: location, value: point.stdRate, deaths: point.deaths });
    }

    lastOptionData = { data, breaks };
    chart.resize();
    chart.setOption(buildOption(lastOptionData, useFastAnimation), {
      notMerge: true,
    });

    exportRows = {
      headers: [
        "Código IBGE",
        "Município",
        "Óbitos",
        "Taxa padronizada (por 100 mil hab.)",
      ],
      rows: data.map((entry) => [
        entry.name,
        dimensions.location_names[entry.name] ?? entry.name,
        entry.deaths,
        roundTo(entry.value, 1),
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () => buildFilenameBase("mapa", store.get()),
    getRows: () => exportRows,
    getExportOption: () =>
      lastOptionData
        ? {
            ...buildOption(lastOptionData, false, true),
            animation: false,
          }
        : {},
  });

  setupChartFullscreen(card, container);
  setupChartShare(card, store);

  subscribeWhenVisible(card, store, render);
}
