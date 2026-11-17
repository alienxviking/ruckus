import pairs from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = pairs.setup(t.ctx);
t.advance(2000);
pairs.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ pairs placeholder");
