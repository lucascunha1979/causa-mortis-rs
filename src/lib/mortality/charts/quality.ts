import { getCoverage } from "../access";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  roundTo,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import { qualityChartTitle, setChartTitle } from "../chart-titles";
import { fetchCoverage } from "../data";
import { indexOf } from "../dimensions";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption } from "../echarts-core";
import { echarts } from "../echarts-core";
import { formatRate } from "../format";
import { chartGridColor, themeColor, tooltipStyle } from "../palette";
import type { FiltersStore } from "../filters";
import { setupChartShare } from "../share";
import type { CoverageTable, Dimensions } from "../types";

echarts.use([LineChart, GridComponent, MarkLineComponent, TooltipComponent]);

const MAX_COVERAGE = 100;
const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 560 };
const SUBTITLE =
  "Estimativa de óbitos captados pelo SIM no estado (indicador DEM.4.02/RIPSA, publicado por UF)";
const AXIS_LINE_WIDTH = 2;

function hasValue(value: number | null): value is number {
  return value != null && !Number.isNaN(value);
}

export function findLatestCoverageYear(
  dimensions: Dimensions,
  coverageTable: CoverageTable,
): number {
  const stateIndex = indexOf(dimensions.locations, "RS");
  for (
    let yearIndex = dimensions.years.length - 1;
    yearIndex >= 0;
    yearIndex--
  ) {
    if (getCoverage(coverageTable, stateIndex, yearIndex) != null)
      return dimensions.years[yearIndex] ?? Math.max(...dimensions.years);
  }
  return Math.max(...dimensions.years);
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
  const fullRangeCheckbox = card.querySelector("#quality-scale-stable");

  let fullRange = true;
  let renderToken = 0;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  if (fullRangeCheckbox instanceof HTMLInputElement) {
    fullRangeCheckbox.addEventListener("change", () => {
      fullRange = fullRangeCheckbox.checked;
      void render();
    });
  }

  interface QualityOptionData {
    years: number[];
    values: (number | null)[];
    selectedYear: number;
    yAxisMin: number;
  }

  let lastOptionData: QualityOptionData | null = null;

  function buildOption(
    optionData: QualityOptionData,
    forceLight = false,
  ): EChartsOption {
    const { years, values, selectedYear, yAxisMin } = optionData;
    const lineColor = themeColor("--color-primary-500", { forceLight });
    const axisLineStyle = {
      color: themeColor("--color-gray-500", { forceLight }),
      width: AXIS_LINE_WIDTH,
    };
    return {
      grid: { left: 48, right: 24, top: 24, bottom: 32 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) =>
          value == null
            ? "sem dado publicado"
            : `${formatRate(Number(value))}%`,
        ...tooltipStyle(),
      },
      xAxis: {
        type: "category",
        data: years.map(String),
        boundaryGap: false,
        axisLine: { lineStyle: axisLineStyle },
        axisLabel: { color: themeColor("--color-gray-600", { forceLight }) },
      },
      yAxis: {
        type: "value",
        name: "Cobertura (%)",
        nameTextStyle: {
          color: themeColor("--color-gray-600", { forceLight }),
        },
        min: yAxisMin,
        max: MAX_COVERAGE,
        axisLine: { show: true, lineStyle: axisLineStyle },
        splitLine: { lineStyle: { color: chartGridColor({ forceLight }) } },
        axisLabel: {
          formatter: (value: number | string) =>
            `${formatRate(Number(value))}%`,
          color: themeColor("--color-gray-600", { forceLight }),
        },
      },
      series: [
        {
          name: "Cobertura do SIM",
          type: "line",
          data: values.map((value) => value ?? null),
          color: lineColor,
          symbolSize: 6,
          connectNulls: false,
          emphasis: { disabled: true },
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
            data: years.includes(selectedYear)
              ? [{ xAxis: String(selectedYear) }]
              : [],
          },
        },
      ],
    };
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const coverageTable = await fetchCoverage();
    if (token !== renderToken) return;

    setChartTitle(titleEl, qualityChartTitle());

    const stateIndex = indexOf(dimensions.locations, "RS");
    const values = dimensions.years.map((_, yearIndex) =>
      getCoverage(coverageTable, stateIndex, yearIndex),
    );
    const known = values.filter(hasValue);
    const yAxisMin = fullRange
      ? 0
      : Math.floor(Math.min(...known, MAX_COVERAGE) / 10) * 10;

    if (subtitleEl)
      subtitleEl.textContent =
        known.length > 0 ? SUBTITLE : "Cobertura ainda não publicada";

    lastOptionData = {
      years: dimensions.years,
      values,
      selectedYear: filters.year,
      yAxisMin,
    };
    chart.resize();
    chart.setOption(buildOption(lastOptionData), { notMerge: true });

    exportRows = {
      headers: ["Ano", "Cobertura do SIM no RS (%)"],
      rows: dimensions.years.map((year, i) => [
        year,
        hasValue(values[i] ?? null) ? roundTo(values[i] ?? 0, 1) : "",
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () => buildFilenameBase("cobertura-sim", store.get()),
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
