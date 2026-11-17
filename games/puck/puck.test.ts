import puck from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = puck.setup(t.ctx);
t.advance(2000);
puck.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ puck placeholder");
