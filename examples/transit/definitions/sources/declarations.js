/*
 * Every raw table the pipeline reads, declared in one place. Static GTFS feeds land one table per
 * GTFS file (all agencies together, keyed by agency_id); realtime feeds land as event streams.
 */
const RAW_GTFS = ["agency","stops","routes","trips","stop_times","calendar","calendar_dates","fare_attributes","fare_rules","shapes","frequencies","transfers","pathways","levels","feed_info","translations","attributions","fare_media","fare_products","fare_leg_rules","fare_transfer_rules","areas","stop_areas","networks","route_networks","timeframes","feed_versions","agency_registry","ntd_monthly_ridership","holiday_calendar","route_type_codes"];

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
