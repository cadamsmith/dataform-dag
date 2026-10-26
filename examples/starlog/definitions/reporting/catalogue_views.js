/*
 * Actions defined in JavaScript rather than .sqlx. One file yields FOUR actions: a declaration, a
 * view per catalogue (generated in a loop, so no file is named after them), and an assertion. Each
 * is its own node, and each one's compiled SQL must be its own: the declaration has none, and must
 * not borrow a sibling view's.
 */
declare({
  schema: "raw",
  name: "raw_catalogue_aliases",
  description: "Alternate designations per object (e.g. M31 = NGC 224), maintained by hand.",
});

for (const catalogue of ["MESSIER", "NGC"]) {
  publish(`obs_${catalogue.toLowerCase()}`, {
    type: "view",
    schema: "reporting",
    tags: ["reporting"],
    description: `Observations of ${catalogue} objects, with any alternate designations.`,
  }).query(
    (ctx) => `
SELECT
  o.*,
  d.object_name,
  a.alias
FROM ${ctx.ref("fct_observations")} AS o
JOIN ${ctx.ref("dim_objects")} AS d USING (object_id)
LEFT JOIN ${ctx.ref("raw_catalogue_aliases")} AS a USING (object_id)
WHERE d.catalogue = '${catalogue}'`,
  );
}

assert("assert_aliases_resolve", { tags: ["quality"] }).query(
  (ctx) => `
SELECT a.object_id
FROM ${ctx.ref("raw_catalogue_aliases")} AS a
LEFT JOIN ${ctx.ref("dim_objects")} AS d USING (object_id)
WHERE d.object_id IS NULL`,
);
