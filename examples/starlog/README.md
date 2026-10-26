# starlog — example Dataform project

A small, self-contained Dataform project for exercising the extension by hand. It is **not** a test
fixture (those live in `packages/core/test/fixtures` and are pinned against a golden compile) — this
one exists to be opened and clicked through.

Domain: an amateur astronomy observation log. Sessions are telescope-nights, observations are
individual objects logged during a session, and the marts layer rolls those up per night.

```
raw_sessions ─┐
raw_observations ─┼─▶ stg_* ─▶ int_session_quality ─┬─▶ fct_observations ─▶ agg_nightly_summary
raw_objects ──┘                   └─▶ dim_objects ──┘                              │
                                                                    grant_reporting_access
```

## Running it

```bash
dataform compile --json   # from this directory; needs the Dataform CLI, no credentials
```

There is no warehouse connection and none is needed: compilation resolves SQL locally and never
contacts BigQuery. `defaultProject: starlog-demo` is a placeholder that no query is run against.

## What each feature is covered by

| Feature | Where to look |
| --- | --- |
| All six node types | `source` (3 declarations), `view`, `table`, `incremental`, `assertion`, `operations` |
| Tag filtering | 8 tags across the project: `staging`, `intermediate`, `marts`, `core`, `reference`, `reporting`, `quality`, `ops` |
| Node search | 20 actions, several sharing prefixes (`stg_`, `raw_`) so partial matches return more than one |
| `config.dependencies`, array form | `intermediate/int_session_quality.sqlx` — depends on `stg_objects` with no `ref()` to it |
| `config.dependencies`, bare string | `operations/grant_reporting_access.sqlx` |
| `config.dependencies`, target object | `assertions/assert_observations_have_session.sqlx` |
| Compiled SQL: incremental variants | `marts/fct_observations.sqlx` compiles all six section kinds — `query`, `incremental query`, and both pre/post operation pairs |
| Compiled SQL: multi-statement | `operations/grant_reporting_access.sqlx` compiles to 3 numbered statements |
| One file → several actions | `marts/dim_objects.sqlx` has inline `config.assertions`, so it compiles to a table **plus two generated assertion nodes**. Selecting the file must resolve to the table, not to an assertion |
| Assertion grouping | **Three clusters** — 3 assertions off `fct_observations`, 2 off `agg_nightly_summary`, 2 off `dim_objects` — beside **two singletons** that must stay ordinary nodes. See below |
| Diagnostics | None by design: a `ref()` in commented-out SQL (`marts/agg_nightly_summary.sqlx`) is ignored by compile. See below |

## Assertion grouping

The project compiles to **20 actions, 9 of them assertions**. The canvas collapses assertions that share
a position (identical dependencies), so it draws **16 nodes**:

| Position | Assertions | On the canvas |
| --- | --- | --- |
| `fct_observations` | 3 (two `uniqueKeys` + one `rowConditions`) | one "3 assertions" node |
| `agg_nightly_summary` | 2 | one "2 assertions" node |
| `dim_objects` | 2 | one "2 assertions" node |
| `int_session_quality` | 1 | stays an ordinary node |
| `fct_observations` + `stg_sessions` | 1 (`assert_observations_have_session`) | stays an ordinary node — a different dependency set is a different position, even though it shares one parent with the cluster above |

The last row is the case worth clicking: sharing *a* parent is not sharing a position.

## No diagnostics, on purpose

`agg_nightly_summary.sqlx` has a commented-out join that references `legacy_nightly_rollup`.
`dataform compile` ignores commented SQL, so the graph reports **zero issues** and the project
compiles with no errors. Uncommenting the join doesn't produce a diagnostic. `dataform compile`
rejects the missing dependency, so the compile fails, the last good graph stays up, and the status
pill shows the error.
