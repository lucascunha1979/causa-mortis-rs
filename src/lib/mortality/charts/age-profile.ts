import {
  AGE_PROFILE_SEXES,
  loadAgeProfile,
  measureLabel,
  measureValue,
  type AgeCell,
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
  ageProfileChartTitle,
  causePathLabel,
  setChartTitle,
  sexLabel,
} from "../chart-titles";
import { indexOf } from "../dimensions";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption } from "../echarts-core";
import { echarts } from "../echarts-core";
import type { FiltersStore } from "../filters";
import { formatInteger, formatPercent, formatRate } from "../format";
import { chartGridColor, themeColor, tooltipStyle } from "../palette";
import { setupChartShare } from "../share";
import type { AgeMeasure, Dimensions, Sex } from "../types";

echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent]);

const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 620 };
const SEX_TOKENS: Record<Sex, string> = {
  Homens: "--color-sex-men",
  Mulheres: "--color-sex-women",
  Ambos: "--color-gray-500",
};

interface ProfileRow {
  label: string;
  cells: (AgeCell | null)[];
}

interface ProfileOptionData {
  rows: ProfileRow[];
  measure: AgeMeasure;
}

function formatMeasure(value: number, measure: AgeMeasure): string {
  if (measure === "deaths") return formatInteger(value);
  if (measure === "rate") return formatRate(value);
  return formatPercent(value / 100);
}

function sortValue(row: ProfileRow, measure: AgeMeasure): number {
  const total = row.cells[AGE_PROFILE_SEXES.indexOf("Ambos")];
  return total ? measureValue(total, measure) : -Infinity;
}

function tableCell(text: string, header = false): HTMLTableCellElement {
  const cell = document.createElement(header ? "th" : "td");
  cell.textContent = text;
  cell.className = header
    ? "px-2 py-1.5 text-right font-semibold whitespace-nowrap first:text-left"
    : "px-2 py-1.5 text-right tabular-nums whitespace-nowrap first:text-left first:whitespace-normal";
  return cell;
}

function renderTable(
  tableEl: HTMLElement,
  rows: ProfileRow[],
  total: ProfileRow,
): void {
  const sexNames = AGE_PROFILE_SEXES.map((sex) => sexLabel(sex));
  const table = document.createElement("table");
  table.className = "w-full text-xs sm:text-sm";

  const head = document.createElement("thead");
  const groupRow = document.createElement("tr");
  const subRow = document.createElement("tr");
  groupRow.className = subRow.className =
    "border-b border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300";
  groupRow.append(tableCell("", true));
  subRow.append(tableCell("Causa", true));
  for (const group of ["Óbitos", "Taxa por 100 mil", "% da faixa"]) {
    const cell = tableCell(group, true);
    cell.colSpan = sexNames.length;
    cell.classList.add("text-center");
    groupRow.append(cell);
    for (const name of sexNames) subRow.append(tableCell(name, true));
  }
  head.append(groupRow, subRow);

  const body = document.createElement("tbody");
  for (const row of [...rows, total]) {
    const tr = document.createElement("tr");
    tr.className =
      row === total
        ? "border-t-2 border-gray-300 font-semibold dark:border-gray-600"
        : "border-b border-gray-100 dark:border-gray-800";
    tr.append(tableCell(row.label));
    for (const measure of ["deaths", "rate", "share"] as const)
      for (const cell of row.cells)
        tr.append(
          tableCell(
            cell ? formatMeasure(measureValue(cell, measure), measure) : "—",
          ),
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
  new ResizeObserver(() => chart.resize()).observe(container);

  const card = container.closest(".chart-card") ?? document;
  const titleEl = card.querySelector("[data-chart-title]");
  const subtitleEl = card.querySelector("[data-chart-subtitle]");
  const tableEl = card.querySelector<HTMLElement>("[data-age-profile-table]");

  let renderToken = 0;
  let lastOptionData: ProfileOptionData | null = null;
  let exportRows: ChartExportRows = { headers: [], rows: [] };

  function buildOption(
    data: ProfileOptionData,
    forceLight = false,
  ): EChartsOption {
    const { rows, measure } = data;
    const labelColor = themeColor("--color-gray-600", { forceLight });
    return {
      grid: { left: 8, right: 56, top: 32, bottom: 8, containLabel: true },
      legend: {
        top: 0,
        textStyle: { color: labelColor },
        data: AGE_PROFILE_SEXES.map((sex) => sexLabel(sex)),
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) =>
          value == null ? "—" : formatMeasure(Number(value), measure),
        ...tooltipStyle(),
      },
      xAxis: {
        type: "value",
        min: 0,
        splitLine: { lineStyle: { color: chartGridColor({ forceLight }) } },
        axisLabel: {
          color: labelColor,
          formatter: (value: number) =>
            measure === "share" ? `${value}%` : formatInteger(value),
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((row) => row.label),
        axisTick: { show: false },
        axisLabel: {
          color: themeColor("--color-gray-700", { forceLight }),
          width: 170,
          overflow: "break",
        },
      },
      series: AGE_PROFILE_SEXES.map((sex, sexPosition) => ({
        name: sexLabel(sex),
        type: "bar",
        color: themeColor(SEX_TOKENS[sex], { forceLight }),
        barMaxWidth: 14,
        data: rows.map((row) => {
          const cell = row.cells[sexPosition];
          return cell ? roundTo(measureValue(cell, measure), 2) : null;
        }),
        label: {
          show: rows.length <= 8,
          position: "right",
          fontSize: 10,
          color: labelColor,
          formatter: (params: { value: unknown }) =>
            params.value == null
              ? ""
              : formatMeasure(Number(params.value), measure),
        },
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
      ageProfileChartTitle(filters, dimensions, profile.band.name),
    );
    if (subtitleEl) subtitleEl.textContent = measureLabel(filters.ageMeasure);

    const yearIndex = indexOf(dimensions.years, filters.year);
    const sexIndices = AGE_PROFILE_SEXES.map((sex) =>
      indexOf(dimensions.sexes, sex),
    );
    const exists = sexIndices.some((si) =>
      profile.locationExists(si, yearIndex),
    );

    if (!exists) {
      chart.clear();
      lastOptionData = null;
      exportRows = { headers: [], rows: [] };
      if (tableEl)
        tableEl.textContent = `${dimensions.location_names[filters.location] ?? filters.location} não existia como município em ${filters.year}; seus dados estão no município de origem.`;
      return;
    }

    const rows: ProfileRow[] = profile.causes
      .map((cause, causeIndex) => ({
        label: cause.label,
        cells: sexIndices.map((si) =>
          profile.causeCell(causeIndex, si, yearIndex),
        ),
      }))
      .sort(
        (a, b) =>
          sortValue(b, filters.ageMeasure) - sortValue(a, filters.ageMeasure),
      );
    const total: ProfileRow = {
      label: `Total · ${causePathLabel(filters)}`,
      cells: sexIndices.map((si) => profile.selectedCell(si, yearIndex)),
    };

    lastOptionData = { rows, measure: filters.ageMeasure };
    chart.resize();
    chart.setOption(buildOption(lastOptionData), { notMerge: true });
    if (tableEl) renderTable(tableEl, rows, total);

    const sexNames = AGE_PROFILE_SEXES.map((sex) => sexLabel(sex));
    exportRows = {
      headers: [
        "Faixa etária",
        "Causa",
        ...sexNames.map((name) => `Óbitos - ${name}`),
        ...sexNames.map((name) => `Taxa por 100 mil - ${name}`),
        ...sexNames.map((name) => `% dos óbitos da faixa - ${name}`),
      ],
      rows: [...rows, total].map((row) => [
        profile.band.name,
        row.label,
        ...(["deaths", "rate", "share"] as const).flatMap((measure) =>
          row.cells.map((cell) =>
            cell
              ? roundTo(
                  measureValue(cell, measure),
                  measure === "deaths" ? 0 : 2,
                )
              : "",
          ),
        ),
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () =>
      `${buildFilenameBase("faixa-etaria", store.get())}-${store.get().ageBand}`,
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
