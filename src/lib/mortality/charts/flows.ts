import type { FeatureCollection, Position } from "geojson";
import { resolveCauseLevel } from "../cause-level";
import {
  buildFilenameBase,
  EXPORT_WIDTH,
  setupChartExport,
  type ChartExportRows,
} from "../chart-export";
import { setupChartFullscreen } from "../chart-fullscreen";
import { subscribeWhenVisible } from "../chart-visibility";
import { flowsChartTitle, setChartTitle } from "../chart-titles";
import {
  fetchFlowsMeta,
  fetchFlowsYear,
  fetchMunicipalitiesGeoJson,
} from "../data";
import {
  LinesChart,
  ScatterChart,
  type LinesSeriesOption,
} from "echarts/charts";
import {
  GeoComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import type { EChartsOption, TopLevelFormatterParams } from "../echarts-core";
import { echarts } from "../echarts-core";
import type { FiltersStore } from "../filters";
import { aggregateFlows, isInsideState, type FlowPair } from "../flows";
import { formatInteger, formatPercent } from "../format";
import { jenksBreaks } from "../jenks";
import {
  chartSurfaceColor,
  mapScaleSteps,
  noDataColor,
  themeColor,
  tooltipStyle,
} from "../palette";
import { setupChartShare } from "../share";
import type { Dimensions, Filters, FlowsMeta } from "../types";

echarts.use([
  LinesChart,
  ScatterChart,
  GeoComponent,
  LegendComponent,
  TooltipComponent,
]);

const MAP_NAME = "rs-municipalities";
const EXPORT_SIZE = { width: EXPORT_WIDTH, height: 680 };
const NETWORK_CLASSES = 4;
const NETWORK_WIDTHS = [0.5, 1, 2, 3.5];
const NETWORK_OPACITIES = [0.25, 0.45, 0.65, 0.85];
const MAX_LINE_WIDTH = 6;
const MAX_HUB_SIZE = 22;

type Coordinates = [number, number];

interface FlowLine {
  pair: FlowPair;
  coords: [Coordinates, Coordinates];
  direction: "out" | "in" | "network";
}

interface Hub {
  index: number;
  deaths: number;
  coords: Coordinates;
}

interface FlowsOptionData {
  lines: FlowLine[];
  hubs: Hub[];
  breaks: number[];
  selected: string | null;
  networkView: boolean;
}

function ringArea(ring: Position[]): { area: number; x: number; y: number } {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0 = 0, y0 = 0] = ring[i] ?? [];
    const [x1 = 0, y1 = 0] = ring[i + 1] ?? [];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  return { area: area / 2, x, y };
}

function centroids(geoJson: FeatureCollection): Map<string, Coordinates> {
  const result = new Map<string, Coordinates>();
  for (const feature of geoJson.features) {
    const name = String(feature.properties?.name ?? "");
    const geometry = feature.geometry;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    let best: { area: number; x: number; y: number } | null = null;
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer) continue;
      const ring = ringArea(outer);
      if (!best || Math.abs(ring.area) > Math.abs(best.area)) best = ring;
    }
    if (best && best.area !== 0)
      result.set(name, [best.x / (6 * best.area), best.y / (6 * best.area)]);
  }
  return result;
}

function classOf(breaks: number[], value: number): number {
  for (let i = 1; i < breaks.length - 1; i++)
    if (value <= (breaks[i] ?? Infinity)) return i - 1;
  return Math.max(breaks.length - 2, 0);
}

function share(part: number, total: number): string {
  return total > 0 ? formatPercent(part / total) : "—";
}

function tableCell(text: string, header = false): HTMLTableCellElement {
  const cell = document.createElement(header ? "th" : "td");
  cell.textContent = text;
  cell.className = header
    ? "sticky top-0 bg-gray-50 px-2 py-1.5 text-right font-semibold whitespace-nowrap first:text-left [&:nth-child(2)]:text-left dark:bg-gray-800"
    : "px-2 py-1.5 text-right tabular-nums whitespace-nowrap first:text-left first:whitespace-normal [&:nth-child(2)]:text-left [&:nth-child(2)]:whitespace-normal";
  return cell;
}

interface TableRow {
  origin: string;
  destination: string;
  deaths: number;
  originShare: number | null;
  direction: string;
}

function renderTable(
  tableEl: HTMLElement,
  rows: TableRow[],
  withDirection: boolean,
): void {
  const table = document.createElement("table");
  table.className = "w-full text-xs sm:text-sm";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of [
    "Residência",
    "Ocorrência",
    ...(withDirection ? ["Sentido"] : []),
    "Óbitos",
    "% dos óbitos de residentes da origem",
  ])
    headRow.append(tableCell(label, true));
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = "border-b border-gray-100 dark:border-gray-800";
    tr.append(
      tableCell(row.origin),
      tableCell(row.destination),
      ...(withDirection ? [tableCell(row.direction)] : []),
      tableCell(formatInteger(row.deaths)),
      tableCell(
        row.originShare === null ? "—" : formatPercent(row.originShare),
      ),
    );
    body.append(tr);
  }
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const cell = tableCell("Nenhuma ligação com os filtros escolhidos.");
    cell.colSpan = withDirection ? 5 : 4;
    tr.append(cell);
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
  const summaryEl = card.querySelector<HTMLElement>("[data-flows-summary]");
  const tableEl = card.querySelector<HTMLElement>("[data-flows-table]");

  if (subtitleEl)
    subtitleEl.textContent =
      "Óbitos em que o município de residência e o de ocorrência são diferentes · linhas por quebras naturais de Jenks";

  let mapRegistered = false;
  let centroidByCode = new Map<string, Coordinates>();
  let renderToken = 0;
  let lastOptionData: FlowsOptionData | null = null;
  let exportRows: ChartExportRows = { headers: [], rows: [] };
  let meta: FlowsMeta | null = null;

  const endpointName = (index: number): string => {
    const name = meta?.endpoint_names[index] ?? String(index);
    return meta && index > meta.municipality_count
      ? `${name} (outro estado)`
      : name;
  };

  function buildOption(
    data: FlowsOptionData,
    forceLight = false,
  ): EChartsOption {
    const steps = mapScaleSteps("rate", { forceLight });
    const outColor = themeColor("--color-primary-600", { forceLight });
    const inColor = themeColor("--color-rate-500", { forceLight });
    const hubColor = themeColor("--color-gray-800", { forceLight });
    const maxDeaths = Math.max(1, ...data.lines.map((l) => l.pair.deaths));
    const maxHub = Math.max(1, ...data.hubs.map((h) => h.deaths));
    const lineTooltip = (line: FlowLine): string =>
      `${endpointName(line.pair.origin)} → ${endpointName(line.pair.destination)}<br/>${formatInteger(line.pair.deaths)} óbitos`;

    const lineSeries: LinesSeriesOption[] = [];
    if (data.networkView) {
      const classes = Math.max(data.breaks.length - 1, 1);
      for (let k = 0; k < classes; k++) {
        const min = data.breaks[k] ?? 0;
        const max = data.breaks[k + 1] ?? min;
        const members = data.lines.filter(
          (line) => classOf(data.breaks, line.pair.deaths) === k,
        );
        lineSeries.push({
          type: "lines",
          name: `${formatInteger(Math.ceil(min))}–${formatInteger(max)} óbitos`,
          coordinateSystem: "geo",
          silent: false,
          zlevel: 1,
          z: 2 + k,
          lineStyle: {
            color:
              steps[Math.round(((k + 1) / classes) * (steps.length - 1))] ??
              inColor,
            width: NETWORK_WIDTHS[k] ?? 1,
            opacity: NETWORK_OPACITIES[k] ?? 0.5,
            curveness: 0.15,
          },
          emphasis: { lineStyle: { opacity: 1 } },
          tooltip: {
            formatter: (raw: TopLevelFormatterParams) => {
              const params = Array.isArray(raw) ? raw[0] : raw;
              const line = members[params?.dataIndex ?? -1];
              return line ? lineTooltip(line) : "";
            },
          },
          data: members.map((line) => ({ coords: line.coords })),
        });
      }
    } else {
      for (const direction of ["out", "in"] as const) {
        const members = data.lines.filter(
          (line) => line.direction === direction,
        );
        lineSeries.push({
          type: "lines",
          name: direction === "out" ? "Saídas" : "Entradas",
          coordinateSystem: "geo",
          zlevel: 1,
          symbol: ["none", "arrow"],
          symbolSize: 6,
          lineStyle: {
            color: direction === "out" ? outColor : inColor,
            opacity: 0.75,
            curveness: 0.2,
          },
          tooltip: {
            formatter: (raw: TopLevelFormatterParams) => {
              const params = Array.isArray(raw) ? raw[0] : raw;
              const line = members[params?.dataIndex ?? -1];
              return line ? lineTooltip(line) : "";
            },
          },
          data: members.map((line) => ({
            coords: line.coords,
            lineStyle: {
              width:
                0.6 +
                (MAX_LINE_WIDTH - 0.6) *
                  Math.sqrt(line.pair.deaths / maxDeaths),
            },
          })),
        });
      }
    }

    return {
      tooltip: { trigger: "item", ...tooltipStyle() },
      legend: {
        bottom: 0,
        left: "left",
        orient: "vertical",
        itemGap: 4,
        data: lineSeries.map((series) => String(series.name)),
        textStyle: { color: themeColor("--color-gray-600", { forceLight }) },
      },
      geo: {
        map: MAP_NAME,
        aspectScale: 0.95,
        layoutCenter: ["55%", "50%"],
        layoutSize: "95%",
        roam: false,
        silent: true,
        itemStyle: {
          areaColor: noDataColor({ forceLight }),
          borderColor: chartSurfaceColor({ forceLight }),
          borderWidth: 0.4,
        },
        regions: data.selected
          ? [
              {
                name: data.selected,
                itemStyle: {
                  areaColor: themeColor("--color-primary-300", { forceLight }),
                },
              },
            ]
          : [],
      },
      series: [
        ...lineSeries,
        {
          type: "scatter",
          name: data.networkView
            ? "Óbitos recebidos de outros municípios"
            : "Municípios ligados",
          coordinateSystem: "geo",
          zlevel: 2,
          symbolSize: (value: number[]) =>
            3 + (MAX_HUB_SIZE - 3) * Math.sqrt((value[2] ?? 0) / maxHub),
          itemStyle: {
            color: hubColor,
            opacity: 0.55,
            borderColor: chartSurfaceColor({ forceLight }),
            borderWidth: 0.5,
          },
          tooltip: {
            formatter: (raw: TopLevelFormatterParams) => {
              const params = Array.isArray(raw) ? raw[0] : raw;
              const hub = data.hubs[params?.dataIndex ?? -1];
              if (!hub) return "";
              return data.networkView
                ? `${endpointName(hub.index)}<br/>${formatInteger(hub.deaths)} óbitos de residentes de outros municípios`
                : `${endpointName(hub.index)}<br/>${formatInteger(hub.deaths)} óbitos na ligação`;
            },
          },
          data: data.hubs.map((hub) => [...hub.coords, hub.deaths]),
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

  function summaryText(
    filters: Filters,
    flowsMeta: FlowsMeta,
    pairs: FlowPair[],
    selectedIndex: number | null,
    lineCount: number,
  ): string {
    const inside = (index: number): boolean => isInsideState(flowsMeta, index);
    const year = String(filters.year);
    if (selectedIndex === null) {
      const total = pairs.reduce((sum, p) => sum + p.deaths, 0);
      const residents = pairs.filter((p) => inside(p.origin));
      const residentTotal = residents.reduce((sum, p) => sum + p.deaths, 0);
      const elsewhereInState = residents
        .filter(
          (p) =>
            p.origin !== p.destination &&
            inside(p.destination) &&
            p.origin < flowsMeta.municipality_count &&
            p.destination < flowsMeta.municipality_count,
        )
        .reduce((sum, p) => sum + p.deaths, 0);
      const outOfState = residents
        .filter((p) => !inside(p.destination))
        .reduce((sum, p) => sum + p.deaths, 0);
      const fromOtherStates = pairs
        .filter((p) => !inside(p.origin))
        .reduce((sum, p) => sum + p.deaths, 0);
      return `Rio Grande do Sul, ${year}: ${formatInteger(total)} óbitos de residentes no estado ou ocorridos nele. Dos ${formatInteger(residentTotal)} óbitos de residentes, ${formatInteger(elsewhereInState)} (${share(elsewhereInState, residentTotal)}) aconteceram em outro município do RS e ${formatInteger(outOfState)} (${share(outOfState, residentTotal)}) em outro estado. Outros ${formatInteger(fromOtherStates)} óbitos ocorridos no RS eram de residentes de outros estados. O mapa mostra ${formatInteger(lineCount)} ligações entre municípios.`;
    }
    const name = endpointName(selectedIndex);
    const outgoing = pairs.filter((p) => p.origin === selectedIndex);
    const incoming = pairs.filter((p) => p.destination === selectedIndex);
    const residentTotal = outgoing.reduce((sum, p) => sum + p.deaths, 0);
    const ownResidents = outgoing
      .filter((p) => p.destination === selectedIndex)
      .reduce((sum, p) => sum + p.deaths, 0);
    const outInState = outgoing
      .filter((p) => p.destination !== selectedIndex && inside(p.destination))
      .reduce((sum, p) => sum + p.deaths, 0);
    const outOfState = residentTotal - ownResidents - outInState;
    const occurredTotal = incoming.reduce((sum, p) => sum + p.deaths, 0);
    const inInState = incoming
      .filter((p) => p.origin !== selectedIndex && inside(p.origin))
      .reduce((sum, p) => sum + p.deaths, 0);
    const inFromOtherStates = occurredTotal - ownResidents - inInState;
    return `${name}, ${year}. Residentes: ${formatInteger(residentTotal)} óbitos, ${formatInteger(ownResidents)} (${share(ownResidents, residentTotal)}) no próprio município, ${formatInteger(outInState)} (${share(outInState, residentTotal)}) em outros municípios do RS e ${formatInteger(outOfState)} em outros estados. Ocorridos no município: ${formatInteger(occurredTotal)} óbitos, ${formatInteger(ownResidents)} de residentes, ${formatInteger(inInState)} (${share(inInState, occurredTotal)}) de residentes de outros municípios do RS e ${formatInteger(inFromOtherStates)} de outros estados.`;
  }

  async function render(): Promise<void> {
    const token = ++renderToken;
    const filters = store.get();
    const [geoJson, flowsMeta, year] = await Promise.all([
      fetchMunicipalitiesGeoJson(),
      fetchFlowsMeta(),
      fetchFlowsYear(filters.year),
    ]);
    if (token !== renderToken) return;
    meta = flowsMeta;
    if (!mapRegistered) {
      echarts.registerMap(
        MAP_NAME,
        geoJson as Parameters<typeof echarts.registerMap>[1],
      );
      centroidByCode = centroids(geoJson);
      mapRegistered = true;
    }

    setChartTitle(titleEl, flowsChartTitle(filters, dimensions));

    const municipalityCount = flowsMeta.municipality_count;
    const pairs = aggregateFlows(
      year.rows,
      resolveCauseLevel(filters),
      filters.sex,
      dimensions,
      flowsMeta.endpoints.length,
    );
    const selectedIndex =
      filters.location === "RS"
        ? null
        : flowsMeta.endpoints.indexOf(filters.location);
    const coordsOf = (index: number): Coordinates | null =>
      index < municipalityCount
        ? (centroidByCode.get(flowsMeta.endpoints[index] ?? "") ?? null)
        : null;
    const residentTotals = new Map<number, number>();
    for (const pair of pairs)
      residentTotals.set(
        pair.origin,
        (residentTotals.get(pair.origin) ?? 0) + pair.deaths,
      );

    const lines: FlowLine[] = [];
    const tableRows: TableRow[] = [];
    const hubTotals = new Map<number, number>();
    const minDeaths = filters.flowMin;
    const showOut = filters.flowDirection !== "in";
    const showIn = filters.flowDirection !== "out";

    for (const pair of pairs) {
      if (pair.origin === pair.destination || pair.deaths < minDeaths) continue;
      let direction: FlowLine["direction"] | null = "network";
      if (selectedIndex !== null) {
        if (pair.origin === selectedIndex && showOut) direction = "out";
        else if (pair.destination === selectedIndex && showIn) direction = "in";
        else direction = null;
      }
      if (direction === null) continue;
      tableRows.push({
        origin: endpointName(pair.origin),
        destination: endpointName(pair.destination),
        deaths: pair.deaths,
        originShare: isInsideState(flowsMeta, pair.origin)
          ? pair.deaths / (residentTotals.get(pair.origin) ?? 1)
          : null,
        direction:
          direction === "out" ? "Saída" : direction === "in" ? "Entrada" : "",
      });
      const from = coordsOf(pair.origin);
      const to = coordsOf(pair.destination);
      if (!from || !to) continue;
      lines.push({ pair, coords: [from, to], direction });
      const hubIndex =
        direction === "out"
          ? pair.destination
          : direction === "in"
            ? pair.origin
            : pair.destination;
      hubTotals.set(hubIndex, (hubTotals.get(hubIndex) ?? 0) + pair.deaths);
    }
    lines.sort((a, b) => a.pair.deaths - b.pair.deaths);
    tableRows.sort((a, b) => b.deaths - a.deaths);

    const hubs: Hub[] = [];
    for (const [index, deaths] of hubTotals) {
      const coords = coordsOf(index);
      if (coords) hubs.push({ index, deaths, coords });
    }

    const networkView = selectedIndex === null;
    const breaks = networkView
      ? jenksBreaks(
          lines.map((line) => line.pair.deaths),
          NETWORK_CLASSES,
        )
      : [];

    if (summaryEl)
      summaryEl.textContent = summaryText(
        filters,
        flowsMeta,
        pairs,
        selectedIndex !== null && selectedIndex >= 0 ? selectedIndex : null,
        lines.length,
      );

    lastOptionData = {
      lines,
      hubs,
      breaks,
      selected: networkView ? null : filters.location,
      networkView,
    };
    applyOption();
    if (tableEl) renderTable(tableEl, tableRows, !networkView);

    exportRows = {
      headers: [
        "Residência",
        "Ocorrência",
        "Sentido",
        "Óbitos",
        "% dos óbitos de residentes da origem",
      ],
      rows: tableRows.map((row) => [
        row.origin,
        row.destination,
        row.direction,
        row.deaths,
        row.originShare === null
          ? ""
          : Math.round(row.originShare * 10000) / 100,
      ]),
    };
  }

  setupChartExport(card, EXPORT_SIZE, {
    getFilenameBase: () =>
      buildFilenameBase("fluxos", { ...store.get(), place: "res" }),
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
