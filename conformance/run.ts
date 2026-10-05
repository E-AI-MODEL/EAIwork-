import { readdirSync, readFileSync } from "node:fs";
import { replay } from "../packages/core/src/index.ts";

let failed = 0;
const dir = new URL("./vectors/", import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const v = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  const r = replay(v.events, v.now);
  const got = Object.fromEntries(Object.entries(r.derived).map(([k, d]: any) => [k, d.status]));
  const again = replay(v.events, v.now).checksum; // determinism
  const okStatus = JSON.stringify(got) === JSON.stringify(v.expect);
  const okRej = JSON.stringify(r.rejected.map((x) => x.index)) === JSON.stringify(v.expectRejected);
  const ok = okStatus && okRej && again === r.checksum;
  if (!ok) { failed++; console.log("FAIL", f, { got, rejected: r.rejected }); }
  else console.log("ok  ", f, "-", v.name);
}
process.exit(failed ? 1 : 0);
