import { test } from "node:test";
import assert from "node:assert/strict";
import { stripLeadingImage } from "../../src/core/normalize.js";
import { mapEntryToNews } from "../../src/core/mapEntry.js";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { readFixture } from "./testHelpers.js";

test("elimina la imagen inicial envuelta en <figure> (forma real de la fuente)", () => {
  const summaryHtml =
    '<figure><img src="https://cdn.example/foto.webp" class="type:primaryImage" /></figure>Texto de la noticia.';
  assert.equal(stripLeadingImage(summaryHtml), "Texto de la noticia.");
});

test("elimina una etiqueta <img> inicial suelta, sin envoltorio <figure>", () => {
  const summaryHtml = '<img src="https://cdn.example/foto.jpg"/>Texto de la noticia.';
  assert.equal(stripLeadingImage(summaryHtml), "Texto de la noticia.");
});

test("un resumen sin marcado se conserva tal cual (edge case spec.md)", () => {
  const summaryHtml = "Texto de la noticia sin imagen.";
  assert.equal(stripLeadingImage(summaryHtml), summaryHtml);
});

test("mapEntryToNews produce un summary sin marcado <figure>/<img> para una entrada real del feed", () => {
  const [entry] = parseAtomFeed(readFixture("normal.xml")).entries;
  assert.ok(entry);
  const mapped = mapEntryToNews(entry, 1000);
  assert.equal(
    mapped.summary,
    "El Concejo Deliberante aprobó por mayoría el presupuesto municipal.",
  );
  assert.doesNotMatch(mapped.summary, /<[^>]+>/);
});
