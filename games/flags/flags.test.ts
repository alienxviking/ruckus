import flags from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = flags.setup(t.ctx);
t.advance(2000);
flags.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ flags placeholder");
