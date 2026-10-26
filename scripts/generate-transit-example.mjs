#!/usr/bin/env node
/**
 * Generates examples/transit: a large, realistic Dataform project for exercising the extension at
 * scale. Its shape follows a real production project (exported with graph-shape.mjs): ~1,400
 * actions, most of them assertions, ~39 parallel per-agency pipelines over a shared core, quality
 * checks that gate publishing, and regional + national rollups.
 *
 * The per-agency folders are near-identical by nature, so they are generated rather than written by
 * hand; everything else is emitted from the tables below. Re-run after editing:
 *
 *   node scripts/generate-transit-example.mjs
 *
 * It deletes and rewrites examples/transit/definitions and examples/transit/includes.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "transit");

// --- The world -------------------------------------------------------------------------------

/** 39 agencies. `mode` picks the extra reference data each one's trip events join. */
const AGENCIES = [
  // Northeast Corridor
  ["mbta", "Massachusetts Bay Transportation Authority", "mixed", "northeast_corridor"],
  ["mta_nyct", "MTA New York City Transit", "rail", "northeast_corridor"],
  ["lirr", "Long Island Rail Road", "rail", "northeast_corridor"],
  ["metro_north", "Metro-North Railroad", "rail", "northeast_corridor"],
  ["njt", "NJ Transit", "mixed", "northeast_corridor"],
  ["path", "Port Authority Trans-Hudson", "rail", "northeast_corridor"],
  ["septa", "Southeastern Pennsylvania Transportation Authority", "mixed", "northeast_corridor"],
  ["wmata", "Washington Metropolitan Area Transit Authority", "mixed", "northeast_corridor"],
  ["mta_maryland", "Maryland Transit Administration", "mixed", "northeast_corridor"],
  // Bay Area
  ["bart", "Bay Area Rapid Transit", "rail", "bay_area"],
  ["sfmta", "San Francisco Municipal Transportation Agency", "mixed", "bay_area"],
  ["ac_transit", "AC Transit", "bus", "bay_area"],
  ["vta", "Santa Clara Valley Transportation Authority", "mixed", "bay_area"],
  ["caltrain", "Caltrain", "rail", "bay_area"],
  ["samtrans", "SamTrans", "bus", "bay_area"],
  ["golden_gate", "Golden Gate Transit and Ferry", "ferry", "bay_area"],
  // Cascadia
  ["trimet", "TriMet", "mixed", "cascadia"],
  ["king_county_metro", "King County Metro", "bus", "cascadia"],
  ["sound_transit", "Sound Transit", "rail", "cascadia"],
  ["community_transit", "Community Transit", "bus", "cascadia"],
  // No regional rollup
  ["cta", "Chicago Transit Authority", "mixed", null],
  ["metra", "Metra", "rail", null],
  ["pace", "Pace Suburban Bus", "bus", null],
  ["marta", "Metropolitan Atlanta Rapid Transit Authority", "mixed", null],
  ["dart", "Dallas Area Rapid Transit", "mixed", null],
  ["houston_metro", "METRO Houston", "mixed", null],
  ["capmetro", "Capital Metro", "bus", null],
  ["rtd_denver", "Regional Transportation District", "mixed", null],
  ["uta", "Utah Transit Authority", "mixed", null],
  ["valley_metro", "Valley Metro", "mixed", null],
  ["la_metro", "LA Metro", "mixed", null],
  ["octa", "Orange County Transportation Authority", "bus", null],
  ["mts_san_diego", "San Diego Metropolitan Transit System", "mixed", null],
  ["rtc_southern_nevada", "RTC Southern Nevada", "bus", null],
  ["metro_transit_mn", "Metro Transit", "mixed", null],
  ["hart", "Hillsborough Area Regional Transit", "bus", null],
  ["jta", "Jacksonville Transportation Authority", "bus", null],
  ["miami_dade", "Miami-Dade Transit", "mixed", null],
  ["ttc", "Toronto Transit Commission", "mixed", null],
].map(([code, name, mode, region]) => ({ code, name, mode, region }));

/** Agencies whose riders transfer to a partner system: they get a transfers mart and checks. */
const TRANSFER_PARTNERS = { caltrain: "bart", path: "njt" };
/** Extra transfer reconciliation checks against a partner's trip events (no mart). */
const TRANSFER_CHECKS = { metro_north: ["mta_nyct"], lirr: ["mta_nyct"], septa: ["njt", "wmata"] };
/** Not reported to the national rollup (ferry-only and interstate rail). */
const NOT_NATIONAL = new Set(["golden_gate", "path"]);

const REGIONS = {
  bay_area: "Bay Area",
  cascadia: "Cascadia",
  northeast_corridor: "Northeast Corridor",
};

/** Static GTFS files (https://gtfs.org/schedule/reference/), declared in raw_gtfs. */
const GTFS_FILES = [
  "agency", "stops", "routes", "trips", "stop_times", "calendar", "calendar_dates",
  "fare_attributes", "fare_rules", "shapes", "frequencies", "transfers", "pathways", "levels",
  "feed_info", "translations", "attributions", "fare_media", "fare_products", "fare_leg_rules",
  "fare_transfer_rules", "areas", "stop_areas", "networks", "route_networks", "timeframes",
];

/** Reference data each mode's trip events join, on top of what every agency joins. */
const MODE_EXTRAS = {
  rail: { core: ["dim_stations"], staging: ["stg_gtfs_stop_times", "stg_gtfs_transfers", "stg_gtfs_pathways"] },
  bus: { core: ["dim_route_patterns"], staging: ["stg_gtfs_shapes"] },
  mixed: { core: ["dim_trips"], staging: ["stg_gtfs_calendar_dates", "stg_gtfs_frequencies", "stg_gtfs_stop_times"] },
  ferry: { core: ["dim_trips"], staging: ["stg_gtfs_calendar_dates"] },
};

// --- Writers ---------------------------------------------------------------------------------

const files = new Map();
const write = (path, text) => files.set(path, text.replace(/^\n/, ""));
const list = (xs, indent = "    ") => xs.map((x) => `${indent}${JSON.stringify(x)}`).join(",\n");
const tagList = (tags) => `[${tags.map((t) => JSON.stringify(t)).join(", ")}]`;
const allAgencyTags = AGENCIES.map((a) => a.code);

function sqlx({ config, body }) {
  const lines = Object.entries(config)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v) && k === "dependencies") return `  ${k}: [\n${list(v)}\n  ]`;
      if (Array.isArray(v)) return `  ${k}: ${tagList(v)}`;
      if (typeof v === "object") return `  ${k}: ${JSON.stringify(v).replace(/"(\w+)":/g, "$1: ")}`;
      return `  ${k}: ${JSON.stringify(v)}`;
    });
  return `config {\n${lines.join(",\n")}\n}\n\n${body.trim()}\n`;
}

// --- Project scaffolding -----------------------------------------------------------------------

write("workflow_settings.yaml", `
# Minimal settings so \`dataform compile\` runs with no BigQuery connection and no credentials.
# Nothing here is ever executed against a warehouse — compilation only resolves SQL locally.
dataformCoreVersion: 3.0.0
defaultProject: transit-demo
defaultDataset: transit
defaultAssertionDataset: transit_assertions
defaultLocation: US
`);

// --- Sources ---------------------------------------------------------------------------------

write("definitions/sources/declarations.js", `
/*
 * Every raw table the pipeline reads, declared in one place. Static GTFS feeds land one table per
 * GTFS file (all agencies together, keyed by agency_id); realtime feeds land as event streams.
 */
const RAW_GTFS = ${JSON.stringify([...GTFS_FILES, "feed_versions", "agency_registry", "ntd_monthly_ridership", "holiday_calendar", "route_type_codes"])};

for (const name of RAW_GTFS) {
  declare({ schema: "raw_gtfs", name });
}

// GTFS-Realtime and AVL/APC streams, partitioned by service_date.
for (const name of ["stop_events", "vehicle_positions", "trip_updates", "service_alerts"]) {
  declare({ schema: "raw_realtime", name });
}

// Hand-maintained: display names, open-data licences and contact details per agency.
declare({ schema: "published", name: "agency_directory" });

declare({ schema: "raw_census", name: "census_tracts" });
`);

// --- Staging: one view per GTFS file ---------------------------------------------------------

const STAGING = [...GTFS_FILES.filter((f) => f !== "timeframes").map((f) => `stg_gtfs_${f}`), "stg_census_tracts"];
for (const name of STAGING) {
  const gtfs = name.replace("stg_gtfs_", "");
  const source = name === "stg_census_tracts" ? "census_tracts" : gtfs;
  const joinFeed = ["trips", "stop_times", "calendar", "calendar_dates", "stops", "routes"].includes(gtfs);
  write(`definitions/staging/${name}.sqlx`, sqlx({
    config: { type: "view", schema: "staging", tags: ["staging"], description: `Typed, deduplicated ${source}${name === "stg_census_tracts" ? "" : ".txt"} rows, one per agency feed.` },
    body: `
SELECT
  *
  EXCEPT (_ingested_at),
  _ingested_at AS loaded_at
FROM ${"${ref(\"" + source + "\")}"} AS src${joinFeed ? `
JOIN ${"${ref(\"feed_versions\")}"} AS fv
  USING (agency_id, feed_version)
WHERE fv.is_current` : ""}
QUALIFY ROW_NUMBER() OVER (PARTITION BY agency_id, feed_version ORDER BY _ingested_at DESC) = 1`,
  }));
}

// --- Core: shared, conformed reference data ---------------------------------------------------

const CORE = {
  dim_agency_registry: { deps: ["agency_registry", "agency"], tags: ["core"] },
  dim_agencies: { deps: ["dim_agency_registry", "stg_gtfs_agency"], tags: ["core"] },
  dim_feed_versions: { deps: ["feed_versions", "dim_agency_registry"], tags: ["core"] },
  dim_stops: { deps: ["stg_gtfs_stops", "stg_gtfs_levels", "stg_gtfs_stop_areas", "stg_gtfs_areas", "stg_census_tracts"], tags: ["core", ...allAgencyTags.slice(0, 36)] },
  dim_routes: { deps: ["stg_gtfs_routes", "stg_gtfs_route_networks", "stg_gtfs_networks", "stg_gtfs_trips", "stg_gtfs_shapes", "dim_stops"], tags: ["core", ...allAgencyTags.slice(0, 37)] },
  dim_trips: { deps: ["stg_gtfs_trips", "stg_gtfs_stop_times", "stg_gtfs_frequencies", "stg_gtfs_calendar", "stg_gtfs_calendar_dates"], tags: ["core", ...allAgencyTags.slice(0, 14)] },
  dim_fare_media: { deps: ["stg_gtfs_fare_media"], tags: ["core"] },
  dim_fare_products: { deps: ["stg_gtfs_fare_products", "stg_gtfs_fare_leg_rules", "dim_fare_media"], tags: ["core", "fares"] },
  dim_stations: { deps: ["dim_stops", "dim_routes", "stg_gtfs_pathways", "stg_gtfs_levels", "stg_gtfs_stops"], tags: ["core", "rail"] },
  dim_route_patterns: { deps: ["dim_agencies", "dim_routes", "dim_fare_media", "stg_gtfs_shapes"], tags: ["core", "bus"] },
  bridge_route_stops: { deps: ["dim_routes", "dim_agency_registry", "fct_scheduled_service"], tags: ["core"] },
  dim_service_patterns: { deps: ["stg_gtfs_trips", "stg_gtfs_stop_times", "dim_stops", "dim_routes", "stg_gtfs_frequencies"], tags: ["core"] },
  dim_holidays: { deps: ["stg_gtfs_feed_info"], tags: ["core", ...allAgencyTags.slice(0, 37)] },
  fct_scheduled_service: { type: "incremental", deps: ["stg_gtfs_trips", "stg_gtfs_stop_times", "dim_routes"], tags: ["core", ...allAgencyTags.slice(0, 37)] },
};
for (const [name, c] of Object.entries(CORE)) {
  const [first, ...rest] = c.deps;
  write(`definitions/core/${name}.sqlx`, sqlx({
    config: {
      type: c.type ?? "table",
      schema: "core",
      tags: c.tags,
      ...(c.type === "incremental" ? { uniqueKey: ["agency_id", "service_date", "trip_id", "stop_sequence"] } : {}),
      description: `Conformed ${name.replace(/^(dim|fct|bridge)_/, "").replace(/_/g, " ")} across every agency feed.`,
    },
    body: `
SELECT
  a.*${rest.map((_, i) => `,\n  j${i}.* EXCEPT (agency_id)`).join("")}
FROM ${"${ref(\"" + first + "\")}"} AS a${rest.map((d, i) => `\nLEFT JOIN ${"${ref(\"" + d + "\")}"} AS j${i}\n  USING (agency_id)`).join("")}${c.type === "incremental" ? `\n\${when(incremental(), \`WHERE a.service_date > (SELECT MAX(service_date) FROM \${self()})\`)}` : ""}`,
  }));
}

// --- Per-agency checks helper (includes/) ------------------------------------------------------

/**
 * The checks every agency gets. `gate: true` checks run BEFORE publishing (the published table
 * depends on them); the rest validate what was published. Names are `assert_<agency>_<suffix>`.
 */
const CHECKS = [
  // Gating: trip events and the daily mart must be sound before anything is published.
  { suffix: "trip_events_unique_event_id", on: ["events"], gate: true, sql: "SELECT event_id FROM ${events} GROUP BY event_id HAVING COUNT(*) > 1" },
  { suffix: "trip_events_no_null_keys", on: ["events"], gate: true, sql: "SELECT * FROM ${events} WHERE trip_id IS NULL OR stop_id IS NULL OR service_date IS NULL" },
  { suffix: "ridership_daily_unique_day_route_stop", on: ["daily"], gate: true, sql: "SELECT service_date, route_id, stop_id FROM ${daily} GROUP BY 1, 2, 3 HAVING COUNT(*) > 1" },
  { suffix: "ridership_daily_nonnegative_counts", on: ["daily"], gate: true, sql: "SELECT * FROM ${daily} WHERE boardings < 0 OR alightings < 0" },
  { suffix: "ridership_daily_complete_service_days", on: ["daily"], gate: true, sql: "SELECT service_date FROM ${daily} GROUP BY 1 HAVING COUNT(DISTINCT route_id) = 0" },
  { suffix: "trip_events_stop_ids_exist", on: ["events", "core:dim_stops"], gate: true, sql: "SELECT e.stop_id FROM ${events} e LEFT JOIN ${core} s USING (agency_id, stop_id) WHERE s.stop_id IS NULL" },
  { suffix: "trip_events_routes_scheduled", on: ["events", "core:fct_scheduled_service"], gate: true, sql: "SELECT e.trip_id FROM ${events} e LEFT JOIN ${core} s USING (agency_id, service_date, trip_id) WHERE s.trip_id IS NULL" },
  { suffix: "trip_events_service_dates_scheduled", on: ["events", "core:fct_scheduled_service"], gate: true, sql: "SELECT e.service_date FROM ${events} e LEFT JOIN ${core} s USING (agency_id, service_date) WHERE s.service_date IS NULL" },
  // Freshness / sanity on the raw-ish layer, not gating (a late feed shouldn't block yesterday).
  { suffix: "trip_events_fresh_within_26h", on: ["events"], sql: "SELECT 1 FROM ${events} HAVING MAX(event_ts) < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR)" },
  { suffix: "trip_events_no_future_timestamps", on: ["events"], sql: "SELECT * FROM ${events} WHERE event_ts > CURRENT_TIMESTAMP()" },
  // The published table, column by column.
  ...["service_date", "route_id", "stop_id", "boardings", "alightings"].map((col) => ({ suffix: `ridership_published_not_null_${col}`, on: ["published"], sql: `SELECT * FROM \${published} WHERE ${col} IS NULL` })),
  { suffix: "published_unique_day_route_stop", on: ["published"], sql: "SELECT service_date, route_id, stop_id FROM ${published} GROUP BY 1, 2, 3 HAVING COUNT(*) > 1" },
  { suffix: "published_boardings_within_capacity", on: ["published"], sql: "SELECT * FROM ${published} WHERE boardings > vehicle_capacity * trips_operated * 2" },
  { suffix: "published_alightings_within_capacity", on: ["published"], sql: "SELECT * FROM ${published} WHERE alightings > vehicle_capacity * trips_operated * 2" },
  { suffix: "published_load_factor_in_range", on: ["published"], sql: "SELECT * FROM ${published} WHERE load_factor NOT BETWEEN 0 AND 2.5" },
  { suffix: "published_service_date_not_future", on: ["published"], sql: "SELECT * FROM ${published} WHERE service_date > CURRENT_DATE()" },
  { suffix: "published_no_gaps_in_service_days", on: ["published"], sql: "SELECT d FROM UNNEST(GENERATE_DATE_ARRAY((SELECT MIN(service_date) FROM ${published}), CURRENT_DATE() - 1)) d LEFT JOIN ${published} p ON p.service_date = d WHERE p.service_date IS NULL" },
  { suffix: "published_routes_active", on: ["published"], sql: "SELECT * FROM ${published} WHERE route_status = 'retired'" },
  { suffix: "published_stop_sequence_monotonic", on: ["published"], sql: "SELECT * FROM ${published} WHERE stop_sequence <= prev_stop_sequence" },
  { suffix: "published_dwell_time_reasonable", on: ["published"], sql: "SELECT * FROM ${published} WHERE avg_dwell_seconds NOT BETWEEN 0 AND 900" },
  { suffix: "published_headway_reasonable", on: ["published"], sql: "SELECT * FROM ${published} WHERE avg_headway_minutes NOT BETWEEN 1 AND 240" },
  // Published vs. source of truth.
  ...["row_count", "boardings_total", "alightings_total", "route_set", "service_days"].map((what) => ({
    suffix: `ridership_published_${what}_matches_trip_events`, on: ["events", "published"],
    sql: `SELECT '${what}' AS check_name FROM (SELECT COUNT(*) n FROM \${events}) e, (SELECT COUNT(*) n FROM \${published}) p WHERE e.n != p.n`,
  })),
  { suffix: "ridership_published_stops_match_core_and_events", on: ["events", "core:dim_stops", "published"], sql: "SELECT p.stop_id FROM ${published} p LEFT JOIN ${core} s USING (agency_id, stop_id) LEFT JOIN ${events} e USING (agency_id, stop_id) WHERE s.stop_id IS NULL OR e.stop_id IS NULL" },
];

write("includes/agency_checks.js", `
/**
 * The data-quality checks every agency gets, defined once. Each agency's checks file calls
 * \`declareChecks(agency)\`; gating checks must pass before that agency's ridership is published (the
 * published table lists them in \`dependencies\`), the rest validate what was published.
 */
const CHECKS = ${JSON.stringify(CHECKS, null, 2)};

/** Agency-specific transfer reconciliation, against a partner agency's trip events. */
function transferChecks(agency, partners) {
  return partners.map((partner) => ({
    suffix: \`trip_events_transfers_reconcile_with_\${partner}\`,
    on: ["events", \`partner:\${partner}\`],
    sql: "SELECT t.transfer_id FROM \${events} t LEFT JOIN \${partner} p USING (transfer_id) WHERE p.transfer_id IS NULL",
  }));
}

function declareChecks(agency, { partners = [], martChecks = [] } = {}) {
  const tables = {
    events: \`\${agency}_trip_events\`,
    daily: \`\${agency}_ridership_daily\`,
    published: \`\${agency}_ridership_published\`,
    transfers: \`\${agency}_transfers_daily\`,
  };
  for (const check of [...CHECKS, ...martChecks, ...transferChecks(agency, partners)]) {
    assert(\`assert_\${agency}_\${check.suffix}\`).query((ctx) => {
      const refs = {};
      for (const on of check.on) {
        const [kind, name] = on.split(":");
        if (kind === "core") refs.core = ctx.ref(name);
        else if (kind === "partner") refs.partner = ctx.ref(\`\${name}_trip_events\`);
        else refs[kind] = ctx.ref(tables[kind]);
      }
      return check.sql.replace(/\\$\\{(\\w+)\\}/g, (_, k) => refs[k]);
    }).tags(["data_quality", "agency_checks", agency, check.gate ? "gating" : "post_publish"]);
  }
}

/** Names of the gating checks, for a published table's \`dependencies\`. */
function gatingChecks(agency) {
  return CHECKS.filter((c) => c.gate).map((c) => \`assert_\${agency}_\${c.suffix}\`);
}

module.exports = { declareChecks, gatingChecks };
`);

// --- Agencies ----------------------------------------------------------------------------------

const gating = (code) => CHECKS.filter((c) => c.gate).map((c) => `assert_${code}_${c.suffix}`);

for (const a of AGENCIES) {
  const dir = `definitions/agencies/${a.code}`;
  const extras = MODE_EXTRAS[a.mode];
  const partner = TRANSFER_PARTNERS[a.code];

  write(`${dir}/model/${a.code}_trip_events.sqlx`, sqlx({
    config: {
      type: "incremental",
      schema: "agency_models",
      tags: [a.code, "trip_events"],
      uniqueKey: ["event_id"],
      description: `${a.name}: one row per vehicle arrival/departure at a stop, matched to the schedule.`,
    },
    body: `
SELECT
  ev.event_id,
  ev.agency_id,
  ev.service_date,
  ev.trip_id,
  t.route_id,
  ev.stop_id,
  ev.stop_sequence,
  ev.event_ts,
  ev.boardings,
  ev.alightings,
  ev.vehicle_capacity
FROM ${"${ref(\"stop_events\")}"} AS ev
JOIN ${"${ref(\"stg_gtfs_trips\")}"} AS t USING (agency_id, trip_id)
JOIN ${"${ref(\"fct_scheduled_service\")}"} AS s USING (agency_id, service_date, trip_id, stop_sequence)
JOIN ${"${ref(\"dim_stops\")}"} AS st USING (agency_id, stop_id)
LEFT JOIN ${"${ref(\"dim_holidays\")}"} AS h USING (service_date)
${[...extras.core, ...extras.staging].map((d) => `LEFT JOIN \${ref("${d}")} USING (agency_id)`).join("\n")}
WHERE ev.agency_id = '${a.code}'
  AND NOT COALESCE(h.no_service, FALSE)
\${when(incremental(), \`AND ev.service_date > (SELECT MAX(service_date) FROM \${self()})\`)}`,
  }));

  write(`${dir}/model/${a.code}_ridership_daily.sqlx`, sqlx({
    config: { type: "table", schema: "agency_models", tags: [a.code, "ridership", "daily"], description: `${a.name}: boardings and alightings per service day, route and stop.` },
    body: `
SELECT
  service_date,
  route_id,
  stop_id,
  SUM(boardings) AS boardings,
  SUM(alightings) AS alightings,
  COUNT(DISTINCT trip_id) AS trips_operated,
  MAX(vehicle_capacity) AS vehicle_capacity
FROM ${"${ref(\"" + a.code + "_trip_events\")}"}
JOIN ${"${ref(\"stop_events\")}"} USING (event_id)${partner ? `\nLEFT JOIN \${ref("${a.code}_transfers_daily")} USING (service_date, stop_id)` : ""}
GROUP BY 1, 2, 3`,
  }));

  if (partner) {
    write(`${dir}/model/${a.code}_transfers_daily.sqlx`, sqlx({
      config: { type: "table", schema: "agency_models", tags: [a.code, "transfers", "daily"], description: `${a.name}: riders transferring to or from ${partner.toUpperCase()} per day and station.` },
      body: `
SELECT
  service_date,
  stop_id,
  COUNT(*) AS transfers
FROM ${"${ref(\"" + a.code + "_trip_events\")}"} AS ours
JOIN ${"${ref(\"" + partner + "_trip_events\")}"} AS theirs
  USING (service_date, stop_id)
JOIN ${"${ref(\"stop_events\")}"} USING (event_id)
WHERE TIMESTAMP_DIFF(theirs.event_ts, ours.event_ts, MINUTE) BETWEEN 0 AND 30
GROUP BY 1, 2`,
    }));
  }

  const opts = [];
  const partners = [...(partner ? [partner] : []), ...(TRANSFER_CHECKS[a.code] ?? [])];
  if (partners.length) opts.push(`partners: ${JSON.stringify(partners)}`);
  if (partner) {
    opts.push(`martChecks: [
    { suffix: "transfers_daily_unique_day_stop", on: ["transfers"], gate: false, sql: "SELECT service_date, stop_id FROM \${transfers} GROUP BY 1, 2 HAVING COUNT(*) > 1" },
    { suffix: "transfers_daily_nonnegative", on: ["transfers"], gate: false, sql: "SELECT * FROM \${transfers} WHERE transfers < 0" },
  ]`);
  }
  write(`${dir}/checks/${a.code}_checks.js`, `
// Data-quality checks for ${a.name}. The shared set lives in includes/agency_checks.js.
agency_checks.declareChecks("${a.code}"${opts.length ? `, {\n  ${opts.join(",\n  ")},\n}` : ""});
`);

  write(`${dir}/published/${a.code}_ridership_published.sqlx`, sqlx({
    config: {
      type: "incremental",
      schema: "published",
      tags: [a.code, "published"],
      uniqueKey: ["service_date", "route_id", "stop_id"],
      description: `${a.name}: validated daily ridership. Builds only after every gating check passes.`,
      dependencies: gating(a.code),
    },
    body: `
SELECT
  d.*,
  SAFE_DIVIDE(d.boardings, d.vehicle_capacity * d.trips_operated) AS load_factor,
  r.route_status,
  latest.feed_version
FROM ${"${ref(\"" + a.code + "_ridership_daily\")}"} AS d
JOIN ${"${ref(\"" + a.code + "_trip_events\")}"} USING (service_date, route_id, stop_id)
JOIN ${"${ref(\"fct_scheduled_service\")}"} AS r USING (route_id)
CROSS JOIN (SELECT MAX(feed_version) AS feed_version FROM ${"${ref(\"stop_events\")}"} WHERE agency_id = '${a.code}') AS latest
\${when(incremental(), \`WHERE d.service_date > (SELECT MAX(service_date) FROM \${self()})\`)}`,
  }));

  write(`${dir}/published/${a.code}_ridership.sqlx`, sqlx({
    config: { type: "view", schema: "published", tags: [a.code, "published", "open_data", "public"], description: `${a.name} ridership for the open-data portal, with the agency's licence attached.` },
    body: `
SELECT
  p.service_date,
  p.route_id,
  p.stop_id,
  p.boardings,
  p.alightings,
  dir.display_name AS agency,
  dir.licence
FROM ${"${ref(\"" + a.code + "_ridership_published\")}"} AS p
CROSS JOIN ${"${ref(\"agency_directory\")}"} AS dir
WHERE dir.agency_id = '${a.code}'`,
  }));
}

// --- Regional rollups ----------------------------------------------------------------------------

for (const [region, label] of Object.entries(REGIONS)) {
  const members = AGENCIES.filter((a) => a.region === region).map((a) => a.code);
  const dir = `definitions/regions/${region}`;
  const union = (suffix) => members.map((m) => `SELECT * FROM \${ref("${m}_${suffix}")}`).join("\nUNION ALL\n");
  write(`${dir}/${region}_published_ridership.sqlx`, sqlx({
    config: { type: "table", schema: "regional_published", tags: ["regional", region], description: `${label}: every member agency's published ridership, side by side.` },
    body: union("ridership_published"),
  }));
  write(`${dir}/${region}_ridership_daily.sqlx`, sqlx({
    config: { type: "table", schema: "regional", tags: ["regional", region], description: `${label}: ridership per day across member agencies, from trip events, reconciled to published.` },
    body: `SELECT * FROM (\n${union("trip_events")}\n)\nJOIN \${ref("${region}_published_ridership")} USING (service_date, route_id, stop_id)`,
  }));
  write(`${dir}/${region}_service_reliability.sqlx`, sqlx({
    config: { type: "table", schema: "regional", tags: ["regional", region], description: `${label}: on-time performance per agency and day.` },
    body: union("trip_events"),
  }));
  write(`${dir}/grant_${region}_dashboard_access.sqlx`, sqlx({
    config: { type: "operations", schema: "transit_assertions", tags: ["ops"] },
    body: `GRANT \`roles/bigquery.dataViewer\` ON SCHEMA regional TO "group:${region.replace(/_/g, "-")}-planners@transit-demo.org"`,
  }));
  const checks = [
    [`${region}_published_ridership`, "every_member_present", `SELECT agency_id FROM UNNEST(${JSON.stringify(members)}) agency_id LEFT JOIN \${ref("${region}_published_ridership")} USING (agency_id) WHERE service_date IS NULL`],
    [`${region}_ridership_daily`, "unique_agency_day", `SELECT agency_id, service_date FROM \${ref("${region}_ridership_daily")} GROUP BY 1, 2 HAVING COUNT(*) > 1`],
    [`${region}_ridership_daily`, "nonnegative_totals", `SELECT * FROM \${ref("${region}_ridership_daily")} WHERE boardings < 0`],
    [`${region}_ridership_daily`, "matches_published", `SELECT 1 FROM \${ref("${region}_ridership_daily")} WHERE boardings IS DISTINCT FROM published_boardings`],
    [`${region}_service_reliability`, "on_time_in_range", `SELECT * FROM \${ref("${region}_service_reliability")} WHERE on_time_pct NOT BETWEEN 0 AND 100`],
    ...(members.length > 7 ? [
      [`${region}_service_reliability`, "no_missing_days", `SELECT 1 FROM \${ref("${region}_service_reliability")} HAVING COUNT(DISTINCT service_date) < 28`],
      [`${region}_service_reliability`, "unique_agency_day", `SELECT agency_id, service_date FROM \${ref("${region}_service_reliability")} GROUP BY 1, 2 HAVING COUNT(*) > 1`],
    ] : []),
  ];
  for (const [table, what, sql] of checks) {
    write(`${dir}/assertions/assert_${table}_${what}.sqlx`, sqlx({
      config: { type: "assertion", schema: "regional_assertions", tags: ["regional", region, "data_quality"] },
      body: sql,
    }));
  }
}

// --- Network-wide and national -------------------------------------------------------------------

const regionalTables = Object.keys(REGIONS).flatMap((r) =>
  ["published_ridership", "ridership_daily", "service_reliability"].map((t) => [r, `${r}_${t}`]),
);
write("definitions/network/network_ridership_daily.sqlx", sqlx({
  config: { type: "incremental", schema: "network", tags: ["network"], uniqueKey: ["region", "service_date"], description: "Ridership and reliability for every region with a rollup, one row per region and day." },
  body: `${regionalTables.map(([r, t]) => `SELECT '${r}' AS region, * FROM \${ref("${t}")}`).join("\nUNION ALL\n")}\nJOIN \${ref("dim_routes")} USING (route_id)`,
}));
write("definitions/network/network_ridership.sqlx", sqlx({
  config: { type: "view", schema: "network", tags: ["network", "public"], description: "Network ridership for dashboards." },
  body: 'SELECT * FROM ${ref("network_ridership_daily")}',
}));
const national = AGENCIES.filter((a) => !NOT_NATIONAL.has(a.code));
write("definitions/national/national_ridership_daily.sqlx", sqlx({
  config: { type: "table", schema: "published", tags: ["national", ...national.map((a) => a.code)], description: "Every NTD-reporting agency's published ridership, for the national dashboard." },
  body: national.map((a) => `SELECT '${a.code}' AS agency_id, * FROM \${ref("${a.code}_ridership_published")}`).join("\nUNION ALL\n"),
}));
write("definitions/national/cross_agency_transfers.sqlx", sqlx({
  config: { type: "table", schema: "agency_models", tags: ["national", "transfers"], description: "Rider transfers between partner systems." },
  body: Object.keys(TRANSFER_PARTNERS).map((a) => `SELECT '${a}' AS agency_id, * FROM \${ref("${a}_transfers_daily")}`).join("\nUNION ALL\n"),
}));

// --- Partner exports (one agency's integrations with outside partners) ---------------------------

write("definitions/partner_exports/partner_sources.js", `
// Feeds partners push to us: the regional fare clearinghouse and the state open-data portal.
declare({ schema: "raw_partners", name: "fare_clearinghouse_transactions" });
declare({ schema: "raw_partners", name: "fare_media_registry" });
declare({ schema: "raw_open_data", name: "portal_downloads" });
`);
const exportsFiles = {
  mbta_gtfs_rt_export: { type: "view", deps: ["mbta_trip_events"], body: "GTFS-Realtime TripUpdates feed rebuilt from matched trip events." },
  mbta_open_data_stop_events: { type: "view", deps: ["mbta_trip_events"], body: "Stop-level events for the state open-data portal." },
  mbta_fare_reconciliation: { type: "table", deps: ["fare_clearinghouse_transactions", "fare_media_registry", "dim_fare_media", "mbta_trip_events"], body: "Clearinghouse fare taps matched to boardings." },
  mbta_fare_reconciliation_summary: { type: "table", deps: ["mbta_fare_reconciliation"], body: "Daily fare reconciliation variance." },
  mbta_published_feed: { type: "view", deps: ["mbta_ridership_published"], body: "Published ridership in the partner exchange format." },
  national_ridership_export: { type: "view", deps: ["national_ridership_daily"], body: "National ridership for the federal reporting partner." },
};
for (const [name, e] of Object.entries(exportsFiles)) {
  write(`definitions/partner_exports/${name}.sqlx`, sqlx({
    config: { type: e.type, schema: "partner_exports", tags: ["partner_exports", "mbta"], description: e.body },
    body: `SELECT *\nFROM ${e.deps.map((d) => `\${ref("${d}")}`).join("\nCROSS JOIN ")}`,
  }));
}

// --- Maintenance -----------------------------------------------------------------------------------

const MAINTENANCE = {
  expire_stop_events_partitions: ["stop_events", "vehicle_positions", "agency_registry"],
  expire_vehicle_positions_partitions: ["vehicle_positions", "stop_events", "agency_registry", "fct_scheduled_service"],
  expire_trip_updates_partitions: ["trip_updates", "stop_events", "agency_registry"],
  compact_service_alerts: ["service_alerts", "stop_events", "fct_scheduled_service", "agency_registry"],
  refresh_realtime_clustering: ["stop_events", "trip_updates", "agency_registry"],
};
for (const [name, deps] of Object.entries(MAINTENANCE)) {
  write(`definitions/maintenance/${name}.sqlx`, sqlx({
    config: { type: "operations", schema: "raw_realtime", tags: ["maintenance"], dependencies: deps },
    body: `-- Keeps raw realtime storage bounded; runs after the day's loads.\nALTER TABLE \${ref("${deps[0]}")} SET OPTIONS (partition_expiration_days = 400)`,
  }));
}

// --- Emit -----------------------------------------------------------------------------------------

rmSync(join(ROOT, "definitions"), { recursive: true, force: true });
rmSync(join(ROOT, "includes"), { recursive: true, force: true });
for (const [path, text] of files) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), text);
}
console.log(`wrote ${files.size} files to ${ROOT}`);
