import {
  AGE_PROFILE_SEXES,
  loadAgeProfile,
  measureLabel,
  measureValue,
} from "../age-profile-data";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  roundTo,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import {
  ageEvolutionChartTitle,
  setChartTitle,
  sexLabel,
} from "../chart-titles";
import { indexOf } from "../dimensions";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption } from "../echarts-core";
import { echarts } from "../echarts-core";
import type { FiltersStore } from "../filters";
import { formatInteger, formatPercent, formatRate } from "../format";
import { chartGridColor, themeColor, tooltipStyle } from "../palette";
import { setupChartShare } from "../share";
import type { AgeMeasure, Dimensions, Sex } from "../types";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
]);

const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 560 };
const SEX_TOKENS: Record<Sex, string> = {
  Homens: "--color-sex-men",
  Mulheres: "--color-sex-women",
  Ambos: "--color-gray-500",
};

interface EvolutionOptionData {
  years: number[];
  series: (number | null)[][];
  measure: AgeMeasure;
  selectedYear: number;
}

function formatMeasure(value: number, measure: AgeMeasure): string {
  if (measure === "deaths") return formatInteger(value);
  if (measure === "rate") return formatRate(value);
  return formatPercent(value / 100);
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

  let renderToken = 0;
  let lastOptionData: EvolutionOptionData | null = null;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  function buildOption(
    data: EvolutionOptionData,
    forceLight = false,
  ): EChartsOption {
    const { years, series, measure, selectedYear } = data;
    const labelColor = themeColor("--color-gray-600", { forceLight });
    const axisLineStyle = {
      color: themeColor("--color-gray-500", { forceLight }),
      width: 2,
    };
    return {
      grid: { left: 56, right: 24, top: 40, bottom: 32 },
      legend: {
        top: 0,
        textStyle: { color: labelColor },
        data: AGE_PROFILE_SEXES.map((sex) => sexLabel(sex)),
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) =>
          value == null ? "—" : formatMeasure(Number(value), measure),
        ...tooltipStyle(),
      },
      xAxis: {
        type: "value",
        min: Math.min(...years),
        max: Math.max(...years),
        minInterval: 1,
        splitLine: { show: false },
        axisLine: { lineStyle: axisLineStyle },
        axisLabel: { color: labelColor, formatter: (v: number) => String(v) },
        axisPointer: { label: { formatter: (p) => String(p.value) } },
      },
      yAxis: {
        type: "value",
        min: 0,
        axisLine: { show: true, lineStyle: axisLineStyle },
        splitLine: { lineStyle: { color: chartGridColor({ forceLight }) } },
        axisLabel: {
          color: labelColor,
          formatter: (value: number) =>
            measure === "share" ? `${value}%` : formatInteger(value),
        },
      },
      series: AGE_PROFILE_SEXES.map((sex, sexPosition) => ({
        name: sexLabel(sex),
        type: "line",
        color: themeColor(SEX_TOKENS[sex], { forceLight }),
        symbolSize: 5,
        connectNulls: false,
        emphasis: { disabled: true },
        data: years.map((year, i) => [year, series[sexPosition]?.[i] ?? null]),
        ...(sexPosition === 0
          ? {
              markArea: {
                silent: true,
                itemStyle: {
                  color: themeColor("--color-gray-500", { forceLight }),
                  opacity: 0.1,
                },
                label: {
                  show: true,
                  position: "insideTop" as const,
                  color: labelColor,
                  fontSize: 11,
                },
                data: [[{ name: "pandemia", xAxis: 2020 }, { xAxis: 2022 }]],
              },
              markLine: {
                silent: true,
                symbol: "none",
                lineStyle: {
                  type: "dashed" as const,
                  color: themeColor("--color-gray-400", { forceLight }),
                },
                label: { formatter: "ano selecionado", color: labelColor },
                data: [{ xAxis: selectedYear }],
              },
            }
          : {}),
      })),
    };
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const profile = await loadAgeProfile(filters, dimensions);
    if (token !== renderToken) return;

    setChartTitle(
      titleEl,
      ageEvolutionChartTitle(filters, dimensions, profile.band.name),
    );
    if (subtitleEl) subtitleEl.textContent = measureLabel(filters.ageMeasure);

    const sexIndices = AGE_PROFILE_SEXES.map((sex) =>
      indexOf(dimensions.sexes, sex),
    );
    const cells = sexIndices.map((si) =>
      dimensions.years.map((_, yi) => profile.selectedCell(si, yi)),
    );
    const series = cells.map((sexCells) =>
      sexCells.map((cell) =>
        cell ? roundTo(measureValue(cell, filters.ageMeasure), 2) : null,
      ),
    );

    lastOptionData = {
      years: dimensions.years,
      series,
      measure: filters.ageMeasure,
      selectedYear: filters.year,
    };
    chart.resize();
    chart.setOption(buildOption(lastOptionData), { notMerge: true });

    const sexNames = AGE_PROFILE_SEXES.map((sex) => sexLabel(sex));
    exportRows = {
      headers: [
        "Ano",
        "Faixa etária",
        ...sexNames.map((name) => `Óbitos - ${name}`),
        ...sexNames.map((name) => `Taxa por 100 mil - ${name}`),
        ...sexNames.map((name) => `% dos óbitos da faixa - ${name}`),
      ],
      rows: dimensions.years.map((year, yi) => [
        year,
        profile.band.name,
        ...(["deaths", "rate", "share"] as const).flatMap((measure) =>
          cells.map((sexCells) => {
            const cell = sexCells[yi];
            return cell
              ? roundTo(
                  measureValue(cell, measure),
                  measure === "deaths" ? 0 : 2,
                )
              : "";
          }),
        ),
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () =>
      `${buildFilenameBase("faixa-etaria-evolucao", store.get())}-${store.get().ageBand}`,
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
