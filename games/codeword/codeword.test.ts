import codeword from "./server";
import { assert, makeTestCtx } from "../../shared/testing";

const t = makeTestCtx(2);
const s = codeword.setup(t.ctx);
t.advance(2000);
codeword.tick?.(s, t.ctx);
assert(t.result, "placeholder ends");
console.log("✓ codeword placeholder");
