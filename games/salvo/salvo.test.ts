import salvo from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = salvo.setup(t.ctx);
t.advance(2000);
salvo.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ salvo placeholder");
