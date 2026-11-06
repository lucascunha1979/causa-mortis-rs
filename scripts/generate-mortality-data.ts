import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildZip } from "../src/lib/mortality/zip.ts";
import type {
  AgeSeries,
  CauseRateEntry,
  CoverageTable,
  DeathsByAgeTable,
  DeathsByCauseGroupTable,
  MortalityIndexed,
  OverallTable,
  PopulationByAgeTable,
  SmrOverallTable,
} from "../src/lib/mortality/types.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_INDEXED = path.join(HERE, "..", "data", "mortality-indexed.json");
const SRC_INDEXED_OCCURRENCE = path.join(
  HERE,
  "..",
  "data",
  "mortality-indexed-ocorrencia.json",
);
const SRC_FLOWS_GZ = path.join(HERE, "..", "data", "fluxos_rs.json.gz");
const SRC_GEO_SIMPLIFIED = path.join(
  HERE,
  "..",
  "data",
  "rs-municipalities-simplified.geojson",
);
const MORTALITY_OUT_DIR = path.join(HERE, "..", "public", "data", "mortality");
const CSV_OUT_DIR = path.join(HERE, "..", "public", "data", "mortality-csv");
const GEO_OUT_DIR = path.join(HERE, "..", "public", "data", "geo");
const FLOWS_OUT_DIR = path.join(MORTALITY_OUT_DIR, "fluxos");
const MANIFEST_OUT_FILE = path.join(
  HERE,
  "..",
  "src",
  "lib",
  "mortality",
  "data-manifest.json",
);

mkdirSync(MORTALITY_OUT_DIR, { recursive: true });
mkdirSync(CSV_OUT_DIR, { recursive: true });

function readIndexedRaw(source: string): string {
  return existsSync(source)
    ? readFileSync(source, "utf-8")
    : gunzipSync(readFileSync(`${source}.gz`)).toString("utf-8");
}

let dimensions!: MortalityIndexed["dimensions"];
const encoder = new TextEncoder();

function shortHash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 10);
}

const JSON_TABLES = [
  "dimensions",
  "overall",
  "deaths_by_cause_group",
  "deaths_by_cause_group_age",
  "deaths_by_external_cause",
  "deaths_by_external_cause_age",
  "deaths_by_assault_means",
  "deaths_by_assault_means_age",
  "deaths_by_detailed_subgroup",
  "deaths_by_detailed_subgroup_age",
  "deaths_by_age",
  "population_by_age",
  "coverage",
  "smr_overall",
  "smr_by_cause_group",
  "smr_by_external_cause",
  "smr_by_assault_means",
  "smr_by_detailed_subgroup",
] as const;

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(";"));
  return `\uFEFF${lines.join("\r\n")}`;
}

function locationName(location: string): string {
  return dimensions.location_names[location] ?? location;
}

function forEachEntry<T>(
  table: (T | null)[][][],
  fn: (location: string, sex: string, year: number, value: T) => void,
): void {
  dimensions.locations.forEach((location, locationIndex) => {
    dimensions.sexes.forEach((sex, sexIndex) => {
      dimensions.years.forEach((year, yearIndex) => {
        const value = table[locationIndex]?.[sexIndex]?.[yearIndex];
        if (value != null) fn(location, sex, year, value);
      });
    });
  });
}

function forEachDetail<T>(
  values: (T | null)[] | null | undefined,
  labels: string[],
  fn: (label: string, value: T) => void,
): void {
  if (!values) return;
  labels.forEach((label, index) => {
    const value = values[index];
    if (value != null) fn(label, value);
  });
}

function forEachAge(
  series: AgeSeries | null | undefined,
  fn: (ageGroup: string, value: number) => void,
): void {
  if (!series) return;
  dimensions.age_groups.forEach((ageGroup, index) => {
    const value = series[index];
    if (value != null) fn(ageGroup, value);
  });
}

function buildOverallCsv(table: OverallTable): string {
  const rows: (string | number)[][] = [];
  forEachEntry(table, (location, sex, year, entry) => {
    const [deaths, crudeRate, stdRate, population] = entry;
    rows.push([
      location,
      locationName(location),
      sex,
      year,
      deaths,
      crudeRate,
      stdRate,
      population,
    ]);
  });
  return toCsv(
    [
      "Território",
      "Nome do território",
      "Sexo",
      "Ano",
      "Óbitos",
      "Taxa bruta (por 100 mil hab.)",
      "Taxa padronizada (por 100 mil hab.)",
      "População",
    ],
    rows,
  );
}

function buildCauseGroupCsv(table: DeathsByCauseGroupTable): string {
  const rows: (string | number)[][] = [];
  forEachEntry(table, (location, sex, year, entries) => {
    forEachDetail(entries, dimensions.cause_groups, (causeGroup, entry) => {
      const [deaths, stdRate] = entry;
      rows.push([
        location,
        locationName(location),
        sex,
        year,
        causeGroup,
        deaths,
        stdRate,
      ]);
    });
  });
  return toCsv(
    [
      "Território",
      "Nome do território",
      "Sexo",
      "Ano",
      "Grupo de causa",
      "Óbitos",
      "Taxa padronizada (por 100 mil hab.)",
    ],
    rows,
  );
}

function buildRateEntryTableCsv(
  table: ((CauseRateEntry | null)[] | null)[][][],
  labels: string[],
  labelHeader: string,
): string {
  const rows: (string | number)[][] = [];
  forEachEntry(table, (location, sex, year, entries) => {
    forEachDetail(entries, labels, (label, entry) => {
      const [deaths, crudeRate, stdRate] = entry;
      rows.push([
        location,
        locationName(location),
        sex,
        year,
        label,
        deaths,
        crudeRate,
        stdRate,
      ]);
    });
  });
  return toCsv(
    [
      "Território",
      "Nome do território",
      "Sexo",
      "Ano",
      labelHeader,
      "Óbitos",
      "Taxa bruta (por 100 mil hab.)",
      "Taxa padronizada (por 100 mil hab.)",
    ],
    rows,
  );
}

function buildAgeTableCsv(
  table: DeathsByAgeTable | PopulationByAgeTable,
  valueHeader: string,
): string {
  const rows: (string | number)[][] = [];
  forEachEntry(table, (location, sex, year, series) => {
    forEachAge(series, (ageGroup, value) => {
      rows.push([location, locationName(location), sex, year, ageGroup, value]);
    });
  });
  return toCsv(
    [
      "Território",
      "Nome do território",
      "Sexo",
      "Ano",
      "Faixa etária",
      valueHeader,
    ],
    rows,
  );
}

function buildCoverageCsv(table: CoverageTable): string {
  const rows: (string | number)[][] = [];
  dimensions.locations.forEach((location, locationIndex) => {
    dimensions.years.forEach((year, yearIndex) => {
      const value = table[locationIndex]?.[yearIndex];
      if (value != null)
        rows.push([location, locationName(location), year, value]);
    });
  });
  return toCsv(
    ["Território", "Nome do território", "Ano", "Cobertura do SIM"],
    rows,
  );
}

function buildSmrOverallCsv(table: SmrOverallTable): string {
  const rows: (string | number)[][] = [];
  forEachEntry(table, (location, sex, year, entry) => {
    const [observed, expected] = entry;
    rows.push([
      location,
      locationName(location),
      sex,
      year,
      observed,
      expected,
      expected > 0 ? Math.round((observed / expected) * 1000) / 1000 : "",
    ]);
  });
  return toCsv(
    [
      "Território",
      "Nome do território",
      "Sexo",
      "Ano",
      "Óbitos observados (idade informada)",
      "Óbitos esperados (taxas do RS)",
      "Razão de mortalidade padronizada",
    ],
    rows,
  );
}

function generateMode(
  label: string,
  source: string,
  jsonOutDir: string,
  writeCsvFiles: boolean,
  zipName: string,
): string {
  mkdirSync(jsonOutDir, { recursive: true });
  const indexedRaw = readIndexedRaw(source);
  const indexed: MortalityIndexed = JSON.parse(indexedRaw);
  dimensions = indexed.dimensions;

  const jsonStats = JSON_TABLES.map((table) => {
    const file = path.join(jsonOutDir, `${table}.json`);
    writeFileSync(file, JSON.stringify(indexed[table]), "utf-8");
    return { table, bytes: statSync(file).size };
  });

  const friendlyCsvs: { table: string; content: string }[] = [
    { table: "overall", content: buildOverallCsv(indexed.overall) },
    {
      table: "deaths_by_cause_group",
      content: buildCauseGroupCsv(indexed.deaths_by_cause_group),
    },
    {
      table: "deaths_by_external_cause",
      content: buildRateEntryTableCsv(
        indexed.deaths_by_external_cause,
        dimensions.external_cause_types,
        "Tipo de causa externa",
      ),
    },
    {
      table: "deaths_by_assault_means",
      content: buildRateEntryTableCsv(
        indexed.deaths_by_assault_means,
        dimensions.assault_means,
        "Meio de agressão",
      ),
    },
    {
      table: "deaths_by_detailed_subgroup",
      content: buildRateEntryTableCsv(
        indexed.deaths_by_detailed_subgroup,
        dimensions.detailed_subgroups,
        "Subgrupo detalhado",
      ),
    },
    {
      table: "deaths_by_age",
      content: buildAgeTableCsv(indexed.deaths_by_age, "Óbitos"),
    },
    {
      table: "population_by_age",
      content: buildAgeTableCsv(indexed.population_by_age, "População"),
    },
    { table: "coverage", content: buildCoverageCsv(indexed.coverage) },
    { table: "smr_overall", content: buildSmrOverallCsv(indexed.smr_overall) },
  ];

  const csvStats = writeCsvFiles
    ? friendlyCsvs.map(({ table, content }) => {
        const file = path.join(CSV_OUT_DIR, `${table}.csv`);
        writeFileSync(file, content, "utf-8");
        return { table, bytes: statSync(file).size };
      })
    : [];

  const bundle = buildZip(
    friendlyCsvs.map(({ table, content }) => {
      const data = encoder.encode(content);
      return {
        name: `${table}.csv`,
        data,
        deflated: new Uint8Array(deflateRawSync(data)),
      };
    }),
  );
  const bundleFile = path.join(CSV_OUT_DIR, zipName);
  writeFileSync(bundleFile, bundle);

  const totalJsonBytes = jsonStats.reduce((sum, s) => sum + s.bytes, 0);
  const totalCsvBytes = csvStats.reduce((sum, s) => sum + s.bytes, 0);

  console.log(
    `OK — ${label} -> ${path.relative(path.join(HERE, ".."), jsonOutDir)}/*.json`,
  );
  console.log(
    `  ${jsonStats.length} tabelas, ${(totalJsonBytes / 1e6).toFixed(2)} MB total`,
  );
  for (const s of jsonStats) {
    console.log(
      `    ${s.table.padEnd(32)} ${(s.bytes / 1e3).toFixed(1).padStart(9)} KB`,
    );
  }

  console.log(`OK — ${label} -> public/data/mortality-csv/`);
  if (csvStats.length > 0)
    console.log(
      `  ${csvStats.length} tabelas, ${(totalCsvBytes / 1e6).toFixed(2)} MB total`,
    );
  for (const s of csvStats) {
    console.log(
      `    ${s.table.padEnd(32)} ${(s.bytes / 1e3).toFixed(1).padStart(9)} KB`,
    );
  }
  console.log(
    `  ${path.relative(path.join(HERE, ".."), bundleFile)} ${(statSync(bundleFile).size / 1e6).toFixed(2)} MB`,
  );

  const LOCATION_SHARDED_TABLES = JSON_TABLES.filter(
    (table) => table !== "dimensions" && table !== "coverage",
  );

  const mortalityVersion = shortHash(indexedRaw);
  const byLocationOutDir = path.join(jsonOutDir, "by-location");
  const versionDir = path.join(byLocationOutDir, mortalityVersion);
  rmSync(byLocationOutDir, { recursive: true, force: true });

  let shardCount = 0;
  let shardBytes = 0;
  for (const table of LOCATION_SHARDED_TABLES) {
    const tableDir = path.join(versionDir, table);
    mkdirSync(tableDir, { recursive: true });
    const fullTable = indexed[table] as unknown[];
    dimensions.locations.forEach((location, locationIndex) => {
      const file = path.join(tableDir, `${location}.json`);
      writeFileSync(file, JSON.stringify(fullTable[locationIndex] ?? []));
      shardCount += 1;
      shardBytes += statSync(file).size;
    });
  }

  console.log(
    `OK — ${label} -> ${path.relative(path.join(HERE, ".."), jsonOutDir)}/by-location/${mortalityVersion}/`,
  );
  console.log(
    `  ${LOCATION_SHARDED_TABLES.length} tabelas × ${dimensions.locations.length} territórios = ${shardCount} arquivos, ${(shardBytes / 1e6).toFixed(2)} MB total`,
  );

  return mortalityVersion;
}

const mortalityVersion = generateMode(
  "data/mortality-indexed.json",
  SRC_INDEXED,
  MORTALITY_OUT_DIR,
  true,
  "causa-mortis-rs-dados-completos.zip",
);
const occurrenceVersion = generateMode(
  "data/mortality-indexed-ocorrencia.json",
  SRC_INDEXED_OCCURRENCE,
  path.join(MORTALITY_OUT_DIR, "ocorrencia"),
  false,
  "causa-mortis-rs-dados-completos-ocorrencia.zip",
);

interface FlowsSource {
  endpoints: string[];
  endpoint_names: string[];
  years: number[];
  rows: Record<string, number[][]>;
}

const flowsRaw = gunzipSync(readFileSync(SRC_FLOWS_GZ)).toString("utf-8");
const flows: FlowsSource = JSON.parse(flowsRaw);
const flowsVersion = shortHash(flowsRaw);
const flowsVersionDir = path.join(FLOWS_OUT_DIR, flowsVersion);
rmSync(FLOWS_OUT_DIR, { recursive: true, force: true });
mkdirSync(flowsVersionDir, { recursive: true });
writeFileSync(
  path.join(flowsVersionDir, "endpoints.json"),
  JSON.stringify({
    endpoints: flows.endpoints,
    endpoint_names: flows.endpoint_names,
    municipality_count: flows.endpoints.indexOf("RS?"),
  }),
);
let flowsBytes = 0;
for (const year of flows.years) {
  const file = path.join(flowsVersionDir, `${year}.json`);
  writeFileSync(
    file,
    JSON.stringify({ year, rows: flows.rows[String(year)] ?? [] }),
  );
  flowsBytes += statSync(file).size;
}
const flowSexes = ["Homens", "Mulheres", "Ignorado"];
const flowLabel = (labels: string[], index: number): string =>
  index >= 0 ? (labels[index] ?? "") : "";
const flowsCsvRows: (string | number)[][] = [];
for (const year of flows.years) {
  for (const [o, d, sx, g, sb, ex, mi, n] of flows.rows[String(year)] ?? []) {
    flowsCsvRows.push([
      year,
      flows.endpoints[o ?? 0] ?? "",
      flows.endpoint_names[o ?? 0] ?? "",
      flows.endpoints[d ?? 0] ?? "",
      flows.endpoint_names[d ?? 0] ?? "",
      flowSexes[sx ?? 2] ?? "",
      flowLabel(dimensions.cause_groups, g ?? -1),
      flowLabel(dimensions.detailed_subgroups, sb ?? -1),
      flowLabel(dimensions.external_cause_types, ex ?? -1),
      flowLabel(dimensions.assault_means, mi ?? -1),
      n ?? 0,
    ]);
  }
}
const flowsCsv = encoder.encode(
  toCsv(
    [
      "Ano",
      "Código da residência",
      "Residência",
      "Código da ocorrência",
      "Ocorrência",
      "Sexo",
      "Grupo de causa",
      "Subgrupo detalhado",
      "Tipo de causa externa",
      "Meio de agressão",
      "Óbitos",
    ],
    flowsCsvRows,
  ),
);
const flowsZipFile = path.join(CSV_OUT_DIR, "causa-mortis-rs-fluxos.zip");
writeFileSync(
  flowsZipFile,
  buildZip([
    {
      name: "fluxos_residencia_ocorrencia.csv",
      data: flowsCsv,
      deflated: new Uint8Array(deflateRawSync(flowsCsv)),
    },
  ]),
);
console.log(
  `OK — data/fluxos_rs.json.gz -> public/data/mortality/fluxos/${flowsVersion}/`,
);
console.log(
  `  ${flowsCsvRows.length} linhas em CSV, ${(statSync(flowsZipFile).size / 1e6).toFixed(2)} MB (zip)`,
);
console.log(
  `  ${flows.years.length} anos, ${(flowsBytes / 1e6).toFixed(2)} MB total`,
);

mkdirSync(GEO_OUT_DIR, { recursive: true });
const geoVersionedDir = path.join(GEO_OUT_DIR, "versioned");
rmSync(geoVersionedDir, { recursive: true, force: true });
const geoSimplifiedRaw = readFileSync(SRC_GEO_SIMPLIFIED, "utf-8");
const geoHash = shortHash(geoSimplifiedRaw);
mkdirSync(path.join(geoVersionedDir, geoHash), { recursive: true });
const geoFile = `versioned/${geoHash}/rs-municipalities.geojson`;
writeFileSync(path.join(GEO_OUT_DIR, geoFile), geoSimplifiedRaw);

console.log(
  `OK — data/rs-municipalities-simplified.geojson -> public/data/geo/${geoFile}`,
);
console.log(
  `  ${(Buffer.byteLength(geoSimplifiedRaw) / 1e3).toFixed(1)} KB (original: ${(statSync(path.join(GEO_OUT_DIR, "rs-municipalities.geojson")).size / 1e6).toFixed(2)} MB, mantido para download)`,
);

writeFileSync(
  MANIFEST_OUT_FILE,
  JSON.stringify(
    { mortalityVersion, occurrenceVersion, flowsVersion, geoFile },
    null,
    2,
  ) + "\n",
);
console.log(`OK — src/lib/mortality/data-manifest.json atualizado`);
