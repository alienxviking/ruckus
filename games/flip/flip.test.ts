import flip from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = flip.setup(t.ctx);
t.advance(2000);
flip.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ flip placeholder");
