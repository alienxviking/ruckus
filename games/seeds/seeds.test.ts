import seeds from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = seeds.setup(t.ctx);
t.advance(2000);
seeds.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ seeds placeholder");
