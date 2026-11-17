import hotseat from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(3);
const s = hotseat.setup(t.ctx);
t.advance(2000);
hotseat.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ hotseat placeholder");
