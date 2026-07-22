import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldOfferWrite,
  shouldShowDetailNudge,
} from "./interviewUi.ts";

test("boundary answers do not receive a generic detail nudge", () => {
  assert.equal(shouldShowDetailNudge(false, "这段我不太方便说，先跳过吧。"), false);
  assert.equal(shouldShowDetailNudge(false, "时间我已经记不清了。"), false);
  assert.equal(shouldShowDetailNudge(false, "挺好的，印象很深。"), true);
});

test("writing is offered only when the interviewer recommends it", () => {
  assert.equal(shouldOfferWrite(true, "continue"), false);
  assert.equal(shouldOfferWrite(false, "write_chapter"), false);
  assert.equal(shouldOfferWrite(true, "write_chapter"), true);
});
