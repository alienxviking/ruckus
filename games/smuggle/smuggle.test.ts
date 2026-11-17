import smuggle from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(4);
const s = smuggle.setup(t.ctx);
t.advance(2000);
smuggle.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ smuggle placeholder");
