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
| Node search | 12 parsed nodes, several sharing prefixes (`stg_`, `raw_`) so partial matches return more than one |
| `config.dependencies`, array form | `intermediate/int_session_quality.sqlx` — depends on `stg_objects` with no `ref()` to it |
| `config.dependencies`, bare string | `operations/grant_reporting_access.sqlx` |
| `config.dependencies`, target object | `assertions/assert_observations_have_session.sqlx` |
| Compiled SQL: incremental variants | `marts/fct_observations.sqlx` compiles all six section kinds — `query`, `incremental query`, and both pre/post operation pairs |
| Compiled SQL: multi-statement | `operations/grant_reporting_access.sqlx` compiles to 3 numbered statements |
| One file → several actions | `marts/dim_objects.sqlx` has inline `config.assertions`, so it compiles to a table **plus two generated assertion nodes**. Selecting the file must resolve to the table, not to an assertion |
| Diagnostics | `marts/agg_nightly_summary.sqlx` carries a `ref()` inside commented-out SQL |

## The intentional diagnostic

`agg_nightly_summary.sqlx` has a commented-out join referencing `legacy_nightly_rollup`. The regex
parser scans the whole file, so it reports one **unresolved reference**; `dataform compile` ignores
commented SQL, so compiled mode reports none.

That difference is the point — it is a live demonstration of the documented parsed-tier limitation,
and switching modes should make the diagnostic appear and disappear. **The project compiles with
zero errors**; the warning is a property of the parsed tier, not a defect in the project.
