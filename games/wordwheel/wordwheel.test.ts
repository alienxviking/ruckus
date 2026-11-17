import wordwheel from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = wordwheel.setup(t.ctx);
t.advance(2000);
wordwheel.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ wordwheel placeholder");
