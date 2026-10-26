/**
 * The data-quality checks every agency gets, defined once. Each agency's checks file calls
 * `declareChecks(agency)`; gating checks must pass before that agency's ridership is published (the
 * published table lists them in `dependencies`), the rest validate what was published.
 */
const CHECKS = [
  {
    "suffix": "trip_events_unique_event_id",
    "on": [
      "events"
    ],
    "gate": true,
    "sql": "SELECT event_id FROM ${events} GROUP BY event_id HAVING COUNT(*) > 1"
  },
  {
    "suffix": "trip_events_no_null_keys",
    "on": [
      "events"
    ],
    "gate": true,
    "sql": "SELECT * FROM ${events} WHERE trip_id IS NULL OR stop_id IS NULL OR service_date IS NULL"
  },
  {
    "suffix": "ridership_daily_unique_day_route_stop",
    "on": [
      "daily"
    ],
    "gate": true,
    "sql": "SELECT service_date, route_id, stop_id FROM ${daily} GROUP BY 1, 2, 3 HAVING COUNT(*) > 1"
  },
  {
    "suffix": "ridership_daily_nonnegative_counts",
    "on": [
      "daily"
    ],
    "gate": true,
    "sql": "SELECT * FROM ${daily} WHERE boardings < 0 OR alightings < 0"
  },
  {
    "suffix": "ridership_daily_complete_service_days",
    "on": [
      "daily"
    ],
    "gate": true,
    "sql": "SELECT service_date FROM ${daily} GROUP BY 1 HAVING COUNT(DISTINCT route_id) = 0"
  },
  {
    "suffix": "trip_events_stop_ids_exist",
    "on": [
      "events",
      "core:dim_stops"
    ],
    "gate": true,
    "sql": "SELECT e.stop_id FROM ${events} e LEFT JOIN ${core} s USING (agency_id, stop_id) WHERE s.stop_id IS NULL"
  },
  {
    "suffix": "trip_events_routes_scheduled",
    "on": [
      "events",
      "core:fct_scheduled_service"
    ],
    "gate": true,
    "sql": "SELECT e.trip_id FROM ${events} e LEFT JOIN ${core} s USING (agency_id, service_date, trip_id) WHERE s.trip_id IS NULL"
  },
  {
    "suffix": "trip_events_service_dates_scheduled",
    "on": [
      "events",
      "core:fct_scheduled_service"
    ],
    "gate": true,
    "sql": "SELECT e.service_date FROM ${events} e LEFT JOIN ${core} s USING (agency_id, service_date) WHERE s.service_date IS NULL"
  },
  {
    "suffix": "trip_events_fresh_within_26h",
    "on": [
      "events"
    ],
    "sql": "SELECT 1 FROM ${events} HAVING MAX(event_ts) < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 26 HOUR)"
  },
  {
    "suffix": "trip_events_no_future_timestamps",
    "on": [
      "events"
    ],
    "sql": "SELECT * FROM ${events} WHERE event_ts > CURRENT_TIMESTAMP()"
  },
  {
    "suffix": "ridership_published_not_null_service_date",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE service_date IS NULL"
  },
  {
    "suffix": "ridership_published_not_null_route_id",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE route_id IS NULL"
  },
  {
    "suffix": "ridership_published_not_null_stop_id",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE stop_id IS NULL"
  },
  {
    "suffix": "ridership_published_not_null_boardings",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE boardings IS NULL"
  },
  {
    "suffix": "ridership_published_not_null_alightings",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE alightings IS NULL"
  },
  {
    "suffix": "published_unique_day_route_stop",
    "on": [
      "published"
    ],
    "sql": "SELECT service_date, route_id, stop_id FROM ${published} GROUP BY 1, 2, 3 HAVING COUNT(*) > 1"
  },
  {
    "suffix": "published_boardings_within_capacity",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE boardings > vehicle_capacity * trips_operated * 2"
  },
  {
    "suffix": "published_alightings_within_capacity",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE alightings > vehicle_capacity * trips_operated * 2"
  },
  {
    "suffix": "published_load_factor_in_range",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE load_factor NOT BETWEEN 0 AND 2.5"
  },
  {
    "suffix": "published_service_date_not_future",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE service_date > CURRENT_DATE()"
  },
  {
    "suffix": "published_no_gaps_in_service_days",
    "on": [
      "published"
    ],
    "sql": "SELECT d FROM UNNEST(GENERATE_DATE_ARRAY((SELECT MIN(service_date) FROM ${published}), CURRENT_DATE() - 1)) d LEFT JOIN ${published} p ON p.service_date = d WHERE p.service_date IS NULL"
  },
  {
    "suffix": "published_routes_active",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE route_status = 'retired'"
  },
  {
    "suffix": "published_stop_sequence_monotonic",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE stop_sequence <= prev_stop_sequence"
  },
  {
    "suffix": "published_dwell_time_reasonable",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE avg_dwell_seconds NOT BETWEEN 0 AND 900"
  },
  {
    "suffix": "published_headway_reasonable",
    "on": [
      "published"
    ],
    "sql": "SELECT * FROM ${published} WHERE avg_headway_minutes NOT BETWEEN 1 AND 240"
  },
  {
    "suffix": "ridership_published_row_count_matches_trip_events",
    "on": [
      "events",
      "published"
    ],
    "sql": "SELECT 'row_count' AS check_name FROM (SELECT COUNT(*) n FROM ${events}) e, (SELECT COUNT(*) n FROM ${published}) p WHERE e.n != p.n"
  },
  {
    "suffix": "ridership_published_boardings_total_matches_trip_events",
    "on": [
      "events",
      "published"
    ],
    "sql": "SELECT 'boardings_total' AS check_name FROM (SELECT COUNT(*) n FROM ${events}) e, (SELECT COUNT(*) n FROM ${published}) p WHERE e.n != p.n"
  },
  {
    "suffix": "ridership_published_alightings_total_matches_trip_events",
    "on": [
      "events",
      "published"
    ],
    "sql": "SELECT 'alightings_total' AS check_name FROM (SELECT COUNT(*) n FROM ${events}) e, (SELECT COUNT(*) n FROM ${published}) p WHERE e.n != p.n"
  },
  {
    "suffix": "ridership_published_route_set_matches_trip_events",
    "on": [
      "events",
      "published"
    ],
    "sql": "SELECT 'route_set' AS check_name FROM (SELECT COUNT(*) n FROM ${events}) e, (SELECT COUNT(*) n FROM ${published}) p WHERE e.n != p.n"
  },
  {
    "suffix": "ridership_published_service_days_matches_trip_events",
    "on": [
      "events",
      "published"
    ],
    "sql": "SELECT 'service_days' AS check_name FROM (SELECT COUNT(*) n FROM ${events}) e, (SELECT COUNT(*) n FROM ${published}) p WHERE e.n != p.n"
  },
  {
    "suffix": "ridership_published_stops_match_core_and_events",
    "on": [
      "events",
      "core:dim_stops",
      "published"
    ],
    "sql": "SELECT p.stop_id FROM ${published} p LEFT JOIN ${core} s USING (agency_id, stop_id) LEFT JOIN ${events} e USING (agency_id, stop_id) WHERE s.stop_id IS NULL OR e.stop_id IS NULL"
  }
];

/** Agency-specific transfer reconciliation, against a partner agency's trip events. */
function transferChecks(agency, partners) {
  return partners.map((partner) => ({
    suffix: `trip_events_transfers_reconcile_with_${partner}`,
    on: ["events", `partner:${partner}`],
    sql: "SELECT t.transfer_id FROM ${events} t LEFT JOIN ${partner} p USING (transfer_id) WHERE p.transfer_id IS NULL",
  }));
}

function declareChecks(agency, { partners = [], martChecks = [] } = {}) {
  const tables = {
    events: `${agency}_trip_events`,
    daily: `${agency}_ridership_daily`,
    published: `${agency}_ridership_published`,
    transfers: `${agency}_transfers_daily`,
  };
  for (const check of [...CHECKS, ...martChecks, ...transferChecks(agency, partners)]) {
    assert(`assert_${agency}_${check.suffix}`).query((ctx) => {
      const refs = {};
      for (const on of check.on) {
        const [kind, name] = on.split(":");
        if (kind === "core") refs.core = ctx.ref(name);
        else if (kind === "partner") refs.partner = ctx.ref(`${name}_trip_events`);
        else refs[kind] = ctx.ref(tables[kind]);
      }
      return check.sql.replace(/\$\{(\w+)\}/g, (_, k) => refs[k]);
    }).tags(["data_quality", "agency_checks", agency, check.gate ? "gating" : "post_publish"]);
  }
}

/** Names of the gating checks, for a published table's `dependencies`. */
function gatingChecks(agency) {
  return CHECKS.filter((c) => c.gate).map((c) => `assert_${agency}_${c.suffix}`);
}

module.exports = { declareChecks, gatingChecks };
