import assert from "node:assert/strict";
import { test } from "node:test";
import { somar } from "./soma.ts";

test("soma dois números", () => {
  assert.equal(somar(2, 3), 5);
});
