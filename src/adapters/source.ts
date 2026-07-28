import { XMLParser } from "fast-xml-parser";

export interface RawEntry {
  title: string;
  summaryHtml: string;
  link: string;
  publishedAt: Date;
  updatedAt: Date | null;
  declaredCategory: string;
  linkPathCategory: string | null;
}

export interface ParsedFeed {
  /** Tamaño total de la ventana devuelta por la fuente, antes de descartar entradas inválidas. */
  totalEntriesInFeed: number;
  entries: RawEntry[];
  /** Errores de entradas individuales que no impiden procesar el resto del feed. */
  entryErrors: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

type TextOrNode = string | { "#text"?: string } | undefined;
interface AtomLinkXml {
  "@_href"?: string;
  "@_rel"?: string;
}
interface AtomCategoryXml {
  "@_term"?: string;
}
interface AtomEntryXml {
  title?: TextOrNode;
  summary?: TextOrNode;
  link?: AtomLinkXml | AtomLinkXml[];
  published?: string;
  updated?: string;
  category?: AtomCategoryXml | AtomCategoryXml[];
}

function textOf(value: TextOrNode): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return value["#text"] ?? "";
}

function linkHrefOf(link: AtomEntryXml["link"]): string {
  if (!link) return "";
  const candidates = Array.isArray(link) ? link : [link];
  const alternate =
    candidates.find((entry) => !entry["@_rel"] || entry["@_rel"] === "alternate") ?? candidates[0];
  return alternate?.["@_href"] ?? "";
}

function categoryOf(category: AtomEntryXml["category"]): string {
  if (!category) return "";
  const first = Array.isArray(category) ? category[0] : category;
  return first?.["@_term"] ?? "";
}

function extractLinkPathCategory(link: string): string | null {
  try {
    const url = new URL(link);
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
    return segments.length > 0 ? (segments[0] ?? null) : null;
  } catch {
    return null;
  }
}

function toRawEntry(raw: AtomEntryXml): RawEntry {
  const link = linkHrefOf(raw.link);
  if (!link) {
    throw new Error("Entrada del feed sin enlace (link)");
  }
  const publishedAt = raw.published ? new Date(raw.published) : null;
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) {
    throw new Error(`Entrada del feed sin fecha de publicación válida (link: ${link})`);
  }
  const updatedRaw = raw.updated ? new Date(raw.updated) : null;
  const updatedAt = updatedRaw && !Number.isNaN(updatedRaw.getTime()) ? updatedRaw : null;
  return {
    title: textOf(raw.title),
    summaryHtml: textOf(raw.summary),
    link,
    publishedAt,
    updatedAt,
    declaredCategory: categoryOf(raw.category),
    linkPathCategory: extractLinkPathCategory(link),
  };
}

/**
 * Falla si la respuesta no es un Atom válido (falta <feed>); una entrada individual inválida
 * dentro de un feed por lo demás válido NO aborta el parseo completo (Artículo VII: degradar,
 * no bloquear), solo se registra en entryErrors.
 */
export function parseAtomFeed(rawBody: string): ParsedFeed {
  const parsed: unknown = parser.parse(rawBody);
  const feed = (parsed as { feed?: { entry?: AtomEntryXml | AtomEntryXml[] } } | undefined)?.feed;
  if (!feed) {
    throw new Error("La respuesta no es un feed Atom válido: falta el elemento <feed>");
  }
  const rawEntries = feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
  const entries: RawEntry[] = [];
  const entryErrors: string[] = [];
  for (const raw of rawEntries) {
    try {
      entries.push(toRawEntry(raw));
    } catch (error) {
      entryErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { totalEntriesInFeed: rawEntries.length, entries, entryErrors };
}

export interface RawFeedBody {
  rawBody: string;
  fetchedAt: Date;
}

/**
 * Separado de `parseAtomFeed` a propósito: si la descarga llega pero el parseo falla, igual
 * queremos poder guardar `rawBody` para diagnóstico (FR-020); si la descarga en sí falla, no
 * hay body que guardar.
 */
export async function fetchRawFeedBody(url: string): Promise<RawFeedBody> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`La fuente respondió con estado HTTP ${response.status}`);
  }
  const rawBody = await response.text();
  return { rawBody, fetchedAt: new Date() };
}
