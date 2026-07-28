import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { determineRunStatus } from "../../src/core/alarms.js";
import { readFixture } from "./testHelpers.js";

test("una respuesta no parseable lanza en vez de devolver un feed vacío silencioso (FR-018)", () => {
  assert.throws(() => parseAtomFeed(readFixture("malformed.xml")), /feed Atom válido/);
});

test("un error de parseo produce una corrida fallida, nunca exitosa", () => {
  let hadFetchError = false;
  try {
    parseAtomFeed(readFixture("malformed.xml"));
  } catch {
    hadFetchError = true;
  }

  assert.equal(determineRunStatus(0, hadFetchError), "failure");
});
