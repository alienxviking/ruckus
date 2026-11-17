import tug from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = tug.setup(t.ctx);
t.advance(2000);
tug.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ tug placeholder");
