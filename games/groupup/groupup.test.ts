import groupup from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = groupup.setup(t.ctx);
t.advance(2000);
groupup.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ groupup placeholder");
