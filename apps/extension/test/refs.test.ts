import { describe, expect, it } from "vitest";
import { findRefs, refAt, resolveTarget } from "../src/refs.js";

const targets = (text: string) => findRefs(text).map((r) => r.target);

describe("findRefs", () => {
  it("reads ref() and resolve() with one, two or three string arguments", () => {
    expect(
      targets(`SELECT * FROM \${ref("a")} JOIN \${ref('s', "b")} JOIN \${resolve("db", "s", "c")}`),
    ).toEqual([
      { name: "a" },
      { schema: "s", name: "b" },
      { database: "db", schema: "s", name: "c" },
    ]);
  });

  it("reads ctx.ref() and a target object", () => {
    expect(targets(`ctx.ref({ schema: "marts", name: "orders" })`)).toEqual([
      { name: "orders", schema: "marts" },
    ]);
  });

  it("reads every form of config dependencies", () => {
    expect(targets(`config { dependencies: "one" }`)).toEqual([{ name: "one" }]);
    expect(
      targets(`config {\n  dependencies: ["two", { schema: "staging", name: "three" }],\n}`),
    ).toEqual([{ name: "two" }, { name: "three", schema: "staging" }]);
    expect(targets(`publish("x").dependencies(["four"])`)).toEqual([{ name: "four" }]);
  });

  it("skips a ref built at runtime", () => {
    expect(findRefs("ref(name) ref(`t_${x}`) ref(\"a\" + suffix)")).toEqual([]);
  });

  it("isn't thrown by brackets or quotes inside the arguments' strings", () => {
    expect(targets(`ref("we(i)rd") ref("it's")`)).toEqual([{ name: "we(i)rd" }, { name: "it's" }]);
  });
});

describe("refAt", () => {
  const text = `FROM \${ref("orders")} JOIN \${ref("customers")}`;

  it("finds the reference under the cursor, anywhere in the call", () => {
    expect(refAt(text, text.indexOf("orders"))?.target.name).toBe("orders");
    expect(refAt(text, text.indexOf("ref(\"customers"))?.target.name).toBe("customers");
  });

  it("finds nothing between references", () => {
    expect(refAt(text, text.indexOf("JOIN"))).toBeUndefined();
  });
});

describe("resolveTarget", () => {
  const ids = new Set(["orders", "staging.users", "marts.users", "p.raw.events"]);

  it("matches a name directly, or its qualified id when it collides", () => {
    expect(resolveTarget({ name: "orders" }, ids)).toEqual(["orders"]);
    expect(resolveTarget({ name: "orders", schema: "anything" }, ids)).toEqual(["orders"]);
    expect(resolveTarget({ name: "users", schema: "marts" }, ids)).toEqual(["marts.users"]);
    expect(resolveTarget({ name: "events", schema: "raw", database: "p" }, ids)).toEqual([
      "p.raw.events",
    ]);
  });

  it("offers every candidate for an ambiguous bare name", () => {
    expect(resolveTarget({ name: "users" }, ids).sort()).toEqual(["marts.users", "staging.users"]);
  });

  it("matches nothing for an unknown name", () => {
    expect(resolveTarget({ name: "nope" }, ids)).toEqual([]);
  });
});
