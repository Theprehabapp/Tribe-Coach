import { test } from "node:test";
import assert from "node:assert/strict";

// api.js builds a Supabase client on import, so the pager is checked through a stand-in module copy.
const src = (await import("node:fs")).readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
const body = src.match(/export async function every\(make\) \{[\s\S]*?\n\}/)[0].replace("export ", "");
const check = ({ data, error }) => { if (error) throw error; return data; };
const every = new Function("check", `${body}; return every;`)(check);

const fakeTable = (n) => () => ({ range: async (a, b) => ({ data: Array.from({ length: Math.max(0, Math.min(b, n - 1) - a + 1) }, (_, i) => a + i), error: null }) });

test("reads every page of a table bigger than 1,000 rows", async () => {
  assert.equal((await every(fakeTable(2500))).length, 2500);
  assert.equal((await every(fakeTable(1000))).length, 1000);
  assert.deepEqual(await every(fakeTable(3)), [0, 1, 2]);
  assert.equal((await every(fakeTable(0))).length, 0);
});

test("passes errors through", async () => {
  await assert.rejects(every(() => ({ range: async () => ({ data: null, error: new Error("nope") }) })), /nope/);
});
