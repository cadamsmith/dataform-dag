# transit — large example Dataform project

A realistically **large** Dataform project for performance work: about 1,500 actions, 2,800 edges
and 13 levels deep. Its shape follows a real production project (exported anonymously with
`scripts/graph-shape.mjs`): many parallel pipelines over a shared core, mostly assertions, with
quality checks that gate publishing. Use [`starlog`](../starlog) to click through features; use
this one to see how the extension holds up.

Domain: ridership reporting for 39 North American transit agencies. Each agency publishes static
GTFS feeds and realtime stop events; the project turns them into validated daily ridership, then
rolls that up by region and nationally.

> **Generated.** The 39 agency folders are near-identical, so the whole project is written by
> [`scripts/generate-transit-example.mjs`](../../scripts/generate-transit-example.mjs). Edit the
> generator and re-run it (`node scripts/generate-transit-example.mjs`) rather than editing files
> here by hand.

## Layout

```
sources (40) ─▶ staging (26 GTFS views) ─▶ core (14 conformed tables) ─┐
                                                                         ▼
   per agency (×39):  trip_events ─▶ ridership_daily ─▶ 8 gating checks ─▶ ridership_published ─▶ ridership (view)
                           └─────────── ~23 post-publish checks ◀─────────────────┘
                                                                         │
   regions (×3: Bay Area 7, Cascadia 4, Northeast Corridor 9) ◀──────────┤
   network rollup ◀── regions                     national rollup (37) ◀─┘
```

| Folder | What's there |
| --- | --- |
| `sources/declarations.js` | Every raw table, declared in one JS loop: 31 `raw_gtfs`, 4 `raw_realtime`, the agency directory, census tracts |
| `staging/` | One view per GTFS file (`stg_gtfs_stops`, `stg_gtfs_trips`, …) |
| `core/` | Shared reference data (`dim_stops`, `dim_routes`, `fct_scheduled_service`, …). The most-shared are tagged with every agency, so `--tags=<agency>` pulls them in |
| `agencies/<agency>/` | `model/` trip events (incremental) and daily ridership; `checks/` one JS file calling `includes/agency_checks.js`, which declares ~31 assertions; `published/` the gated incremental and its open-data view |
| `regions/<region>/` | Three regional tables, a dashboard-access operation, and their assertions |
| `network/`, `national/` | Cross-region and national rollups, cross-agency transfers |
| `partner_exports/` | One agency's exports to outside partners, with their own source declarations |
| `maintenance/` | Partition-expiry operations on the realtime sources |

## What it exercises

| Behavior | Where |
| --- | --- |
| Scale | 1,501 actions (1,236 assertions); assertion grouping draws about 590 nodes |
| Assertions that are NOT leaves | Each agency's 8 gating checks are dependencies of its published table, so they sit mid-graph |
| Grouping at scale | 240 assertion groups: 39 of 15 (post-publish column checks), plus groups of 2–5 |
| JS-defined actions | The agency checks and every source declaration come from `.js` files |
| Hubs | `fct_scheduled_service` has ~160 dependents, `stop_events` ~120 |
| Long names | Median 48 characters (`assert_king_county_metro_ridership_published_not_null_route_id`) |
| Tags at scale | `data_quality` on 1,236 actions; core tables carrying 37 agency tags |
| Folder view | Deep, repetitive folders: `agencies/<agency>/{model,checks,published}` |

## Running it

```bash
dataform compile --json   # from this directory; needs the Dataform CLI, no credentials (~3 s)
```

Nothing is ever run against a warehouse; `defaultProject: transit-demo` is a placeholder. Agency
names are real; all data, numbers and partner details are invented.
