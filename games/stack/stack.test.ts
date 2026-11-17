import stack from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = stack.setup(t.ctx);
t.advance(2000);
stack.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ stack placeholder");
