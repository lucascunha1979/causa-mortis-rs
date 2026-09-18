import { loadLocationRatePointGetter, resolveCauseLevel } from "../cause-level";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  roundTo,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption, LineSeriesOption } from "../echarts-core";
import { echarts } from "../echarts-core";
import { evolutionChartTitle, setChartTitle } from "../chart-titles";
import { indexOf } from "../dimensions";
import { formatInteger, formatRate } from "../format";
import { chartGridColor, themeColor, tooltipStyle } from "../palette";
import type { FiltersStore } from "../filters";
import { setupChartShare } from "../share";
import type { Dimensions, Filters } from "../types";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
]);

const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 560 };
const GRID_TOP = 24;
const GRID_BOTTOM = 32;
const AXIS_LINE_WIDTH = 2;
const PRELIMINARY_AREA_START_OFFSET = 0.4;
const MOVING_AVERAGE_WINDOW = 3;

export function movingAverage(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const start = Math.max(0, index - half);
    const end = Math.min(values.length - 1, index + half);
    let sum = 0;
    for (let i = start; i <= end; i++) sum += values[i] ?? 0;
    return sum / (end - start + 1);
  });
}

export function linearTrend(years: number[], values: number[]): number[] {
  const n = years.length;
  if (n < 2) return [...values];
  const meanX = years.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = (years[i] ?? 0) - meanX;
    sxy += dx * ((values[i] ?? 0) - meanY);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return years.map((year) => meanY + slope * (year - meanX));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function auxiliaryLine(
  name: string,
  years: number[],
  values: number[],
  color: string,
  lineType: "dashed" | "dotted",
): LineSeriesOption {
  return {
    name,
    type: "line",
    data: years.map((year, index) => [year, values[index] ?? 0]),
    color,
    symbol: "none",
    lineStyle: { type: lineType, width: 1.5, opacity: 0.85 },
    emphasis: { disabled: true },
  };
}

type YearPoint = [number, number];
type LinePoint =
  YearPoint | { value: YearPoint; label: Record<string, unknown> };

function withLastPointLabel(
  years: number[],
  data: number[],
  position: "top" | "bottom",
  color: string,
  formatter: string,
): LinePoint[] {
  return data.map((value, index) => {
    const point: YearPoint = [years[index] ?? 0, value];
    return index === data.length - 1
      ? {
          value: point,
          label: {
            show: true,
            position,
            formatter,
            color,
            fontSize: 11,
            fontWeight: 600,
          },
        }
      : point;
  });
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
  if (subtitleEl) subtitleEl.textContent = "Taxa/100 mil habitantes";
  const movingAverageCheckbox = card.querySelector("#evolution-moving-average");
  const periodMeanCheckbox = card.querySelector("#evolution-period-mean");
  const trendCheckbox = card.querySelector("#evolution-trend");
  let showMovingAverage = false;
  let showPeriodMean = false;
  let showTrend = false;
  for (const [checkbox, apply] of [
    [movingAverageCheckbox, (v: boolean) => (showMovingAverage = v)],
    [periodMeanCheckbox, (v: boolean) => (showPeriodMean = v)],
    [trendCheckbox, (v: boolean) => (showTrend = v)],
  ] as const) {
    if (!(checkbox instanceof HTMLInputElement)) continue;
    checkbox.addEventListener("change", () => {
      apply(checkbox.checked);
      void render();
    });
  }
  let renderToken = 0;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  interface EvolutionOptionData {
    years: number[];
    standardized: number[];
    crude: number[];
    startYear: number;
    endYear: number;
    dataMaxYear: number;
    selectedYear: number;
    animate: boolean;
    movingAverage: boolean;
    periodMean: boolean;
    trend: boolean;
  }

  let lastOptionData: EvolutionOptionData | null = null;

  function buildOption(
    data: EvolutionOptionData,
    forceLight = false,
  ): EChartsOption {
    const {
      years,
      standardized,
      crude,
      startYear,
      endYear,
      dataMaxYear,
      selectedYear,
      animate,
      movingAverage: withMovingAverage,
      periodMean: withPeriodMean,
      trend: withTrend,
    } = data;
    const lastIndex = years.length - 1;
    const standardizedIsHigher =
      (standardized[lastIndex] ?? 0) >= (crude[lastIndex] ?? 0);
    const standardizedColor = themeColor("--color-rate-500", { forceLight });
    const crudeColor = themeColor("--color-gray-500", { forceLight });
    const axisLineStyle = {
      color: themeColor("--color-gray-500", { forceLight }),
      width: AXIS_LINE_WIDTH,
    };

    const auxiliary: LineSeriesOption[] = [];
    if (withMovingAverage) {
      auxiliary.push(
        auxiliaryLine(
          `Média móvel ${MOVING_AVERAGE_WINDOW} anos (padronizada)`,
          years,
          movingAverage(standardized, MOVING_AVERAGE_WINDOW),
          standardizedColor,
          "dashed",
        ),
        auxiliaryLine(
          `Média móvel ${MOVING_AVERAGE_WINDOW} anos (bruta)`,
          years,
          movingAverage(crude, MOVING_AVERAGE_WINDOW),
          crudeColor,
          "dashed",
        ),
      );
    }
    if (withTrend) {
      auxiliary.push(
        auxiliaryLine(
          "Tendência linear (padronizada)",
          years,
          linearTrend(years, standardized),
          standardizedColor,
          "dotted",
        ),
        auxiliaryLine(
          "Tendência linear (bruta)",
          years,
          linearTrend(years, crude),
          crudeColor,
          "dotted",
        ),
      );
    }
    const periodMeanLines = withPeriodMean
      ? [
          {
            name: "Média do período (padronizada)",
            yAxis: mean(standardized),
            lineStyle: { color: standardizedColor },
          },
          {
            name: "Média do período (bruta)",
            yAxis: mean(crude),
            lineStyle: { color: crudeColor },
          },
        ]
      : [];

    return {
      animation: animate,
      grid: {
        left: 48,
        right: 80,
        top: auxiliary.length > 0 ? GRID_TOP + 28 : GRID_TOP,
        bottom: GRID_BOTTOM,
      },
      legend: {
        show: auxiliary.length > 0,
        top: 0,
        selectedMode: false,
        textStyle: { color: themeColor("--color-gray-600", { forceLight }) },
        data: auxiliary.map((series) => String(series.name)),
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatRate(Number(value)),
        ...tooltipStyle(),
      },
      xAxis: {
        type: "value",
        min: startYear,
        max: endYear,
        minInterval: 1,
        splitLine: { show: false },
        axisLine: { lineStyle: axisLineStyle },
        axisLabel: {
          formatter: (value: number) => String(value),
          color: themeColor("--color-gray-600", { forceLight }),
        },
        axisPointer: {
          label: {
            formatter: (params) => String(params.value),
          },
        },
      },
      yAxis: {
        type: "value",
        name: "Taxa (por 100 mil hab.)",
        nameTextStyle: {
          color: themeColor("--color-gray-600", { forceLight }),
        },
        min: 0,
        axisLine: { show: true, lineStyle: axisLineStyle },
        splitLine: { lineStyle: { color: chartGridColor({ forceLight }) } },
        axisLabel: {
          formatter: (value: number | string) => formatInteger(Number(value)),
          color: themeColor("--color-gray-600", { forceLight }),
        },
      },
      series: [
        {
          name: "Padronizada por idade",
          type: "line",
          data: withLastPointLabel(
            years,
            standardized,
            standardizedIsHigher ? "top" : "bottom",
            standardizedColor,
            "Padronizada por idade",
          ),
          color: standardizedColor,
          symbolSize: 5,
          emphasis: { disabled: true },
          markArea: {
            silent: true,
            itemStyle: {
              color: themeColor("--color-gray-500", { forceLight }),
              opacity: 0.1,
            },
            label: {
              show: true,
              position: "insideTop",
              color: themeColor("--color-gray-600", { forceLight }),
              fontSize: 11,
            },
            data: [
              [{ name: "pandemia", xAxis: 2020 }, { xAxis: 2022 }],
              [
                {
                  name: "preliminar",
                  xAxis: dataMaxYear - 1 + PRELIMINARY_AREA_START_OFFSET,
                },
                { xAxis: dataMaxYear },
              ],
            ],
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: {
              type: "dashed",
              color: themeColor("--color-gray-400", { forceLight }),
            },
            label: {
              formatter: "ano selecionado",
              color: themeColor("--color-gray-600", { forceLight }),
            },
            data: [
              ...(selectedYear >= startYear && selectedYear <= endYear
                ? [{ xAxis: selectedYear }]
                : []),
              ...periodMeanLines.map((line) => ({
                ...line,
                label: {
                  formatter: `${line.name}: ${formatRate(line.yAxis)}`,
                  position: "insideEndTop" as const,
                  color: themeColor("--color-gray-600", { forceLight }),
                },
              })),
            ],
          },
        },
        {
          name: "Bruta",
          type: "line",
          data: withLastPointLabel(
            years,
            crude,
            standardizedIsHigher ? "bottom" : "top",
            crudeColor,
            "Bruta",
          ),
          color: crudeColor,
          symbolSize: 5,
          emphasis: { disabled: true },
        },
        ...auxiliary,
      ],
    };
  }

  let previousFilters: Filters | null = null;

  function isSameSeries(filters: Filters): boolean {
    return (
      previousFilters !== null &&
      previousFilters.location === filters.location &&
      previousFilters.sex === filters.sex &&
      previousFilters.causeGroup === filters.causeGroup &&
      previousFilters.detailedSubgroup === filters.detailedSubgroup &&
      previousFilters.externalCauseType === filters.externalCauseType &&
      previousFilters.assaultMeans === filters.assaultMeans
    );
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const animate = !isSameSeries(filters);
    previousFilters = filters;
    const level = resolveCauseLevel(filters);
    const pointGetter = await loadLocationRatePointGetter(
      level,
      dimensions,
      filters.location,
    );
    if (token !== renderToken) return;

    setChartTitle(titleEl, evolutionChartTitle(filters, dimensions));

    const sexIndex = indexOf(dimensions.sexes, filters.sex);
    const startIndex = indexOf(dimensions.years, filters.yearStart);
    const endIndex = indexOf(dimensions.years, filters.yearEnd);

    const years = dimensions.years.slice(startIndex, endIndex + 1);
    const crude: number[] = [];
    const standardized: number[] = [];
    for (let yearIndex = startIndex; yearIndex <= endIndex; yearIndex++) {
      const point = pointGetter(sexIndex, yearIndex);
      crude.push(point.crudeRate);
      standardized.push(point.stdRate);
    }

    lastOptionData = {
      years,
      standardized,
      crude,
      startYear: filters.yearStart,
      endYear: filters.yearEnd,
      dataMaxYear: Math.max(...dimensions.years),
      selectedYear: filters.year,
      animate,
      movingAverage: showMovingAverage,
      periodMean: showPeriodMean,
      trend: showTrend,
    };
    chart.resize();
    chart.setOption(buildOption(lastOptionData), { notMerge: true });

    const standardizedAverage = movingAverage(
      standardized,
      MOVING_AVERAGE_WINDOW,
    );
    const crudeAverage = movingAverage(crude, MOVING_AVERAGE_WINDOW);
    const standardizedTrend = linearTrend(years, standardized);
    const crudeTrend = linearTrend(years, crude);
    exportRows = {
      headers: [
        "Ano",
        "Taxa padronizada (por 100 mil hab.)",
        "Taxa bruta (por 100 mil hab.)",
        `Média móvel ${MOVING_AVERAGE_WINDOW} anos (padronizada)`,
        `Média móvel ${MOVING_AVERAGE_WINDOW} anos (bruta)`,
        "Tendência linear (padronizada)",
        "Tendência linear (bruta)",
        "Média do período (padronizada)",
        "Média do período (bruta)",
      ],
      rows: years.map((year, i) => [
        year,
        roundTo(standardized[i] ?? 0, 1),
        roundTo(crude[i] ?? 0, 1),
        roundTo(standardizedAverage[i] ?? 0, 1),
        roundTo(crudeAverage[i] ?? 0, 1),
        roundTo(standardizedTrend[i] ?? 0, 1),
        roundTo(crudeTrend[i] ?? 0, 1),
        roundTo(mean(standardized), 1),
        roundTo(mean(crude), 1),
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () => buildFilenameBase("evolucao", store.get()),
    getRows: () => exportRows,
    getExportOption: () =>
      lastOptionData
        ? { ...buildOption(lastOptionData, true), animation: false }
        : {},
  });

  setupChartFullscreen(card, container);
  setupChartShare(card, store);

  subscribeWhenVisible(card, store, render);
}
