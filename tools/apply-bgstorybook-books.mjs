import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_DATA_PATH = path.resolve("story/data/storybook-data.js");
const REMOTE_BOOK_FILES = {
  c4: path.resolve("tools/bgstorybook-c4.json"),
  c5: path.resolve("tools/bgstorybook-c5.json"),
};

// 故事书用拇指图标标出「另起一段」的入口。来源页没把这类段落做成标题时，标记行会并进上一段正文，
// 于是这一段连同后面的编号一起消失；这里按标记切开，标记行留在新段正文开头（和书上排版一致）。
const THUMB_HEADING_RE = /[（(]\s*拇指\s*[)）]\s*(\*?\d{3,5}|M\d{3})(?=$|[\s:：|·\-–—])/g;

function loadLocalStorybook(source) {
  const prefix = "window.STORYBOOK_DATA = ";
  if (!source.startsWith(prefix)) throw new Error("Unexpected story/data/storybook-data.js prefix");
  return JSON.parse(source.slice(prefix.length).replace(/;\s*$/, ""));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[()?:!,.，。！；：、"'“”‘’]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[|/\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isNumberEntry(id) {
  return /^(?:\*?\d{3,5}|M\d{3})$/i.test(String(id || ""));
}

function isHubLayerEntry(chapter, entry, entryType) {
  if (entryType === "number" || !chapter.key.startsWith("hub-")) return false;
  return /^(?:α|Ω|\d{1,2}-\d{1,2})$/i.test(normalizeText(entry.id));
}

function splitThumbSections(entry) {
  const text = String(entry.text ?? "");
  const markers = [...text.matchAll(THUMB_HEADING_RE)].filter((match) => match.index > 0);
  if (!markers.length) return [entry];

  const parts = [];
  let cursor = 0;
  markers.forEach((marker, markerIndex) => {
    parts.push({ ...entry, text: text.slice(cursor, marker.index).trim() });
    const end = markers[markerIndex + 1]?.index ?? text.length;
    const { html, ...rest } = entry;
    parts.push({
      ...rest,
      id: marker[1],
      title: marker[1],
      text: text.slice(marker.index, end).trim(),
    });
    cursor = end;
  });
  return parts.filter((part) => String(part.text ?? "").trim());
}

function toLocalBook(remoteBook) {
  let order = 0;
  const entries = [];

  remoteBook.chapters.forEach((chapter, chapterIndex) => {
    let currentEncounter = null;

    const chapterEntries = chapter.entries.flatMap((entry) => splitThumbSections(entry));
    chapterEntries.forEach((entry, entryIndex) => {
      const entryType = isNumberEntry(entry.id) ? "number" : "heading";
      let encounterKey = null;
      let encounter = null;

      if (chapter.key === "main") {
        currentEncounter = null;
      } else if (chapter.key.startsWith("hub-")) {
        if (isHubLayerEntry(chapter, entry, entryType)) {
          encounterKey = slugify(entry.title || entry.id);
          encounter = entry.title || entry.id;
        }
      } else if (entryType === "heading") {
        encounterKey = slugify(entry.title || entry.id);
        encounter = entry.title || entry.id;
        currentEncounter = { key: encounterKey, title: encounter };
      } else if (currentEncounter) {
        encounterKey = currentEncounter.key;
        encounter = currentEncounter.title;
      }

      const localEntry = {
        key: `${remoteBook.id}-${chapterIndex}-${entryIndex}`,
        id: entry.id,
        title: entry.title,
        entryType,
        chapterKey: chapter.key,
        chapter: chapter.title,
        encounterKey,
        encounter,
        section: encounter || chapter.title,
        order,
        line: entryIndex + 1,
        text: entry.text,
        links: {},
      };
      if (entry.html) localEntry.html = entry.html;
      entries.push(localEntry);
      order += 1;
    });
  });

  return {
    id: remoteBook.id,
    title: remoteBook.title,
    source: remoteBook.source,
    entryCount: entries.length,
    chapters: remoteBook.chapters.map((chapter, index) => ({
      key: chapter.key,
      title: chapter.title,
      line: index + 1,
    })),
    entries,
  };
}

async function main() {
  const requested = process.argv.slice(2);
  const bookIds = requested.length ? requested : Object.keys(REMOTE_BOOK_FILES);
  const localSource = await fs.readFile(LOCAL_DATA_PATH, "utf8");
  const data = loadLocalStorybook(localSource);

  for (const bookId of bookIds) {
    const file = REMOTE_BOOK_FILES[bookId];
    if (!file) throw new Error(`Unknown book id: ${bookId}`);
    const remoteBook = JSON.parse(await fs.readFile(file, "utf8"));
    const localBook = toLocalBook(remoteBook);
    const existingIndex = data.books.findIndex((book) => book.id === bookId);

    if (existingIndex >= 0) {
      data.books[existingIndex] = localBook;
    } else {
      const previousCycleIndex = data.books.findIndex((book) => book.id === `c${Number(bookId.slice(1)) - 1}`);
      const insertIndex = previousCycleIndex >= 0 ? previousCycleIndex + 1 : data.books.length;
      data.books.splice(insertIndex, 0, localBook);
    }

    console.log(`${bookId}: ${localBook.chapters.length} chapters, ${localBook.entries.length} entries`);
  }

  data.generatedAt = new Date().toISOString();
  await fs.writeFile(LOCAL_DATA_PATH, `window.STORYBOOK_DATA = ${JSON.stringify(data)};\n`, "utf8");
  console.log(`updated ${LOCAL_DATA_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { splitThumbSections, toLocalBook };
