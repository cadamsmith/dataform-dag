// Data-quality checks for Port Authority Trans-Hudson. The shared set lives in includes/agency_checks.js.
agency_checks.declareChecks("path", {
  partners: ["njt"],
  martChecks: [
    { suffix: "transfers_daily_unique_day_stop", on: ["transfers"], gate: false, sql: "SELECT service_date, stop_id FROM ${transfers} GROUP BY 1, 2 HAVING COUNT(*) > 1" },
    { suffix: "transfers_daily_nonnegative", on: ["transfers"], gate: false, sql: "SELECT * FROM ${transfers} WHERE transfers < 0" },
  ],
});
