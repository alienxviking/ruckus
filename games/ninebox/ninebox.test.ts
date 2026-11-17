import ninebox from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = ninebox.setup(t.ctx);
t.advance(2000);
ninebox.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ ninebox placeholder");
