import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { toLocalDateKey, isValidIanaTimeZone } from "../../src/core/localTime.js";
import { readFixture } from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";

test("una fecha UTC de madrugada se atribuye al día local anterior (FR-010)", () => {
  const [entry] = parseAtomFeed(readFixture("utc-midnight-entry.xml")).entries;
  assert.ok(entry);
  assert.equal(entry.publishedAt.toISOString(), "2026-07-28T02:15:00.000Z");

  const localDay = toLocalDateKey(entry.publishedAt, TIMEZONE);

  assert.equal(localDay, "2026-07-27");
});

test("rechaza offsets numéricos como si fueran zonas IANA (Artículo VI)", () => {
  assert.equal(isValidIanaTimeZone("America/Argentina/Buenos_Aires"), true);
  assert.equal(isValidIanaTimeZone("-03:00"), false);
  assert.equal(isValidIanaTimeZone("GMT-3"), false);
  assert.equal(isValidIanaTimeZone("Etc/GMT+3"), false, "Etc/GMT+3 es un offset fijo disfrazado de zona IANA");
});
