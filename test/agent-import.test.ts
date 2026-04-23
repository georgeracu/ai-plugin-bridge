import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseSelection } from "../dist/select.js";

describe("parseSelection", () => {
  test("parses comma-separated numbers", () => {
    assert.deepEqual(parseSelection("1,3,5", 7), [0, 2, 4]);
  });

  test("parses ranges", () => {
    assert.deepEqual(parseSelection("2-4", 5), [1, 2, 3]);
  });

  test("parses mixed input", () => {
    assert.deepEqual(parseSelection("1,3-5,7", 7), [0, 2, 3, 4, 6]);
  });

  test("ignores out-of-range values", () => {
    assert.deepEqual(parseSelection("0,1,99", 3), [0]);
  });

  test("deduplicates", () => {
    assert.deepEqual(parseSelection("1,1,2-3,2", 5), [0, 1, 2]);
  });

  test("returns empty array for empty input", () => {
    assert.deepEqual(parseSelection("", 5), []);
  });
});
