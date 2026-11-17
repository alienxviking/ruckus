import truths from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(3);
const s = truths.setup(t.ctx);
t.advance(2000);
truths.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ truths placeholder");
