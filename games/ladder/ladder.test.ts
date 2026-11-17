import ladder from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = ladder.setup(t.ctx);
t.advance(2000);
ladder.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ ladder placeholder");
