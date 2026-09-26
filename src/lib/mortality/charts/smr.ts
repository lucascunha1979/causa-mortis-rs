import { resolveCauseLevel } from "../cause-level";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  roundTo,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import { setChartTitle, smrChartTitle } from "../chart-titles";
import { fetchMunicipalitiesGeoJson } from "../data";
import { indexOf } from "../dimensions";
import { MapChart } from "echarts/charts";
import { TooltipComponent, VisualMapComponent } from "echarts/components";
import type { EChartsOption, TopLevelFormatterParams } from "../echarts-core";
import { echarts } from "../echarts-core";
import type { FiltersStore } from "../filters";
import { formatInteger, formatRate } from "../format";
import {
  chartSurfaceColor,
  noDataColor,
  themeColor,
  tooltipStyle,
} from "../palette";
import { setupChartShare } from "../share";
import {
  loadSmrGetter,
  periodYearIndices,
  SMR_CLASS_LABELS,
  SMR_CLASS_ORDER,
  smrForPeriod,
  type SmrClass,
  type SmrResult,
} from "../smr";
import type { Dimensions, Filters } from "../types";

echarts.use([MapChart, TooltipComponent, VisualMapComponent]);

const MAP_NAME = "rs-municipalities";
const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 620 };
const RATIO_FORMAT = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface SmrRow {
  location: string;
  name: string;
  result: SmrResult;
}

interface SmrOptionData {
  rows: SmrRow[];
}

function formatRatio(value: number): string {
  return RATIO_FORMAT.format(value);
}

function classColor(smrClass: SmrClass, forceLight: boolean): string {
  if (smrClass === "no-data") return noDataColor({ forceLight });
  const token: Record<Exclude<SmrClass, "no-data">, string> = {
    "above-significant": "--color-rate-500",
    above: "--color-rate-300",
    below: "--color-primary-300",
    "below-significant": "--color-primary-600",
  };
  return themeColor(token[smrClass], { forceLight });
}

function differenceText(result: SmrResult): string {
  const percent = Math.round(Math.abs(result.ratio - 1) * 100);
  if (percent === 0) return "praticamente igual ao esperado";
  return `${percent}% ${result.ratio > 1 ? "acima" : "abaixo"} do esperado`;
}

function summaryText(
  filters: Filters,
  dimensions: Dimensions,
  periodLabel: string,
  result: SmrResult | null,
): string {
  if (filters.location === "RS")
    return "No Rio Grande do Sul a razão é 1 por definição, porque as taxas do próprio estado são a referência. Escolha um município no filtro de território para ver o resumo dele.";
  const name = dimensions.location_names[filters.location] ?? filters.location;
  if (!result || result.smrClass === "no-data")
    return `${name}: sem dado para ${periodLabel} com os filtros escolhidos.`;
  const significance =
    result.smrClass === "above-significant" ||
    result.smrClass === "below-significant"
      ? "A diferença é estatisticamente significativa."
      : "A diferença não é estatisticamente significativa: pode ser flutuação ao acaso.";
  return `${name}, ${periodLabel}: ${formatInteger(result.observed)} óbitos observados e ${formatRate(result.expected)} esperados. Razão ${formatRatio(result.ratio)} (IC 95%: ${formatRatio(result.lower)} a ${formatRatio(result.upper)}), ${differenceText(result)}. ${significance}`;
}

function tableCell(text: string, header = false): HTMLTableCellElement {
  const cell = document.createElement(header ? "th" : "td");
  cell.textContent = text;
  cell.className = header
    ? "sticky top-0 bg-gray-50 px-2 py-1.5 text-right font-semibold whitespace-nowrap first:text-left dark:bg-gray-800"
    : "px-2 py-1.5 text-right tabular-nums whitespace-nowrap first:text-left first:whitespace-normal";
  return cell;
}

function renderTable(
  tableEl: HTMLElement,
  rows: SmrRow[],
  selected: string,
): void {
  const table = document.createElement("table");
  table.className = "w-full text-xs sm:text-sm";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of [
    "Município",
    "Observados",
    "Esperados",
    "Razão",
    "IC 95%",
    "Classificação",
  ])
    headRow.append(tableCell(label, true));
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className =
      row.location === selected
        ? "border-b border-gray-100 bg-primary-50 font-semibold dark:border-gray-800 dark:bg-primary-950"
        : "border-b border-gray-100 dark:border-gray-800";
    const { result } = row;
    const hasRatio = result.smrClass !== "no-data";
    tr.append(
      tableCell(row.name),
      tableCell(formatInteger(result.observed)),
      tableCell(formatRate(result.expected)),
      tableCell(hasRatio ? formatRatio(result.ratio) : "—"),
      tableCell(
        hasRatio
          ? `${formatRatio(result.lower)} a ${formatRatio(result.upper)}`
          : "—",
      ),
      tableCell(SMR_CLASS_LABELS[result.smrClass]),
    );
    body.append(tr);
  }
  table.append(head, body);
  tableEl.replaceChildren(table);
}

export function init(
  container: HTMLElement,
  store: FiltersStore,
  dimensions: Dimensions,
): void {
  const chart = echarts.init(container);
  const hasSize = (): boolean =>
    container.clientWidth > 0 && container.clientHeight > 0;

  const card = container.closest(".chart-card") ?? document;
  const titleEl = card.querySelector("[data-chart-title]");
  const subtitleEl = card.querySelector("[data-chart-subtitle]");
  const summaryEl = card.querySelector<HTMLElement>("[data-smr-summary]");
  const tableEl = card.querySelector<HTMLElement>("[data-smr-table]");

  if (subtitleEl)
    subtitleEl.textContent =
      "Razão de mortalidade padronizada (SMR): óbitos observados ÷ esperados pelas taxas do RS, por faixa etária";

  const municipalityLocations = dimensions.locations.filter(
    (location) => location !== "RS",
  );
  let mapRegistered = false;
  let renderToken = 0;
  let lastOptionData: SmrOptionData | null = null;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  function buildOption(data: SmrOptionData, forceLight = false): EChartsOption {
    const byName = new Map(data.rows.map((row) => [row.location, row]));
    return {
      tooltip: {
        formatter: (raw: TopLevelFormatterParams) => {
          const params = Array.isArray(raw) ? raw[0] : raw;
          if (!params) return "";
          const row = byName.get(params.name);
          const label = `${dimensions.location_names[params.name] ?? params.name} (${params.name})`;
          if (!row || row.result.smrClass === "no-data")
            return `${label}<br/>sem dado`;
          const { result } = row;
          return `${label}<br/>Razão ${formatRatio(result.ratio)} (IC 95%: ${formatRatio(result.lower)} a ${formatRatio(result.upper)})<br/>${formatInteger(result.observed)} observados · ${formatRate(result.expected)} esperados<br/>${SMR_CLASS_LABELS[result.smrClass]}`;
        },
        ...tooltipStyle(),
      },
      visualMap: {
        type: "piecewise",
        inverse: true,
        pieces: SMR_CLASS_ORDER.map((smrClass, index) => ({
          value: index,
          label: SMR_CLASS_LABELS[smrClass],
          color: classColor(smrClass, forceLight),
        })),
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
          itemStyle: {
            areaColor: noDataColor({ forceLight }),
            borderColor: chartSurfaceColor({ forceLight }),
            borderWidth: 0.4,
          },
          emphasis: {
            label: { show: false },
            itemStyle: {
              borderColor: themeColor("--color-gray-800", { forceLight }),
              borderWidth: 1.5,
            },
          },
          select: { disabled: true },
          label: { show: false },
          data: data.rows.map((row) => ({
            name: row.location,
            value: SMR_CLASS_ORDER.indexOf(row.result.smrClass),
          })),
        },
      ],
    };
  }

  let pendingOption = false;
  function applyOption(): void {
    if (!lastOptionData || !hasSize()) {
      pendingOption = lastOptionData !== null;
      return;
    }
    pendingOption = false;
    chart.resize();
    chart.setOption(buildOption(lastOptionData), { notMerge: true });
  }
  new ResizeObserver(() => {
    if (!hasSize()) return;
    if (pendingOption) applyOption();
    else chart.resize();
  }).observe(container);

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const [geoJson, getter] = await Promise.all([
      fetchMunicipalitiesGeoJson(),
      loadSmrGetter(resolveCauseLevel(filters), dimensions),
    ]);
    if (token !== renderToken) return;
    if (!mapRegistered) {
      echarts.registerMap(
        MAP_NAME,
        geoJson as Parameters<typeof echarts.registerMap>[1],
      );
      mapRegistered = true;
    }

    const yearIndices = periodYearIndices(
      dimensions,
      filters.year,
      filters.smrPeriod,
    );
    const firstYear = dimensions.years[yearIndices[0] ?? 0] ?? filters.year;
    const periodLabel =
      firstYear === filters.year
        ? String(filters.year)
        : `${firstYear}-${filters.year}`;
    const sexIndex = indexOf(dimensions.sexes, filters.sex);

    setChartTitle(titleEl, smrChartTitle(filters, periodLabel));

    const rows: SmrRow[] = [];
    for (const location of municipalityLocations) {
      const result = smrForPeriod(
        getter,
        indexOf(dimensions.locations, location),
        sexIndex,
        yearIndices,
      );
      if (result)
        rows.push({
          location,
          name: dimensions.location_names[location] ?? location,
          result,
        });
    }
    rows.sort((a, b) => {
      const aNoData = a.result.smrClass === "no-data";
      const bNoData = b.result.smrClass === "no-data";
      if (aNoData !== bNoData) return aNoData ? 1 : -1;
      return b.result.ratio - a.result.ratio;
    });

    const selectedResult =
      filters.location === "RS"
        ? null
        : smrForPeriod(
            getter,
            indexOf(dimensions.locations, filters.location),
            sexIndex,
            yearIndices,
          );
    if (summaryEl)
      summaryEl.textContent = summaryText(
        filters,
        dimensions,
        periodLabel,
        selectedResult,
      );

    lastOptionData = { rows };
    applyOption();
    if (tableEl) renderTable(tableEl, rows, filters.location);

    exportRows = {
      headers: [
        "Código IBGE",
        "Município",
        "Período",
        "Óbitos observados",
        "Óbitos esperados",
        "Razão de mortalidade padronizada",
        "IC 95% inferior",
        "IC 95% superior",
        "Classificação",
      ],
      rows: rows.map((row) => {
        const hasRatio = row.result.smrClass !== "no-data";
        return [
          row.location,
          row.name,
          periodLabel,
          row.result.observed,
          roundTo(row.result.expected, 2),
          hasRatio ? roundTo(row.result.ratio, 3) : "",
          hasRatio ? roundTo(row.result.lower, 3) : "",
          hasRatio ? roundTo(row.result.upper, 3) : "",
          SMR_CLASS_LABELS[row.result.smrClass],
        ];
      }),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () =>
      `${buildFilenameBase("smr", store.get())}-${store.get().smrPeriod}anos`,
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
