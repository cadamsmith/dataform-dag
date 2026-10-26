// Data-quality checks for Caltrain. The shared set lives in includes/agency_checks.js.
agency_checks.declareChecks("caltrain", {
  partners: ["bart"],
  martChecks: [
    { suffix: "transfers_daily_unique_day_stop", on: ["transfers"], gate: false, sql: "SELECT service_date, stop_id FROM ${transfers} GROUP BY 1, 2 HAVING COUNT(*) > 1" },
    { suffix: "transfers_daily_nonnegative", on: ["transfers"], gate: false, sql: "SELECT * FROM ${transfers} WHERE transfers < 0" },
  ],
});
