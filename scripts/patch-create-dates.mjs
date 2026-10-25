import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/modules/eap");
const rangeStart = 'plannedStartAt: "2026-06-01T15:00:00.000Z"';
const rangeEnd = 'plannedEndAt: "2026-06-30T15:00:00.000Z"';
const point = 'plannedAt: "2026-06-15T15:00:00.000Z"';

function skipString(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function matchParen(src, openIndex) {
  let depth = 1;
  let i = openIndex + 1;
  while (i < src.length && depth > 0) {
    const char = src[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(src, i);
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth === 0) return i;
    i += 1;
  }
  return -1;
}

function splitArgs(src, openParen, closeParen) {
  const args = [];
  let start = openParen + 1;
  let depth = 0;
  let i = openParen + 1;
  while (i < closeParen) {
    const char = src[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(src, i);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  args.push(src.slice(start, closeParen));
  return args;
}

function inject(objectText, fields) {
  const close = objectText.lastIndexOf("}");
  if (close === -1) return objectText;
  const prefix = objectText.slice(0, close);
  const trimmed = prefix.trimEnd();
  const indent = prefix.match(/\n([ \t]*)$/);
  let insertion;
  if (trimmed.endsWith("{")) {
    insertion = fields.join(", ");
  } else if (trimmed.endsWith(",")) {
    insertion = indent ? `\n${indent[1]}${fields.join(`,\n${indent[1]}`)}` : ` ${fields.join(", ")}`;
  } else {
    insertion = `, ${fields.join(", ")}`;
  }
  return `${prefix}${insertion}${objectText.slice(close)}`;
}

function patchObject(objectText, kind) {
  const fields = [];
  if (kind === "milestone") {
    if (!objectText.includes("plannedAt")) fields.push(point);
  } else {
    if (!objectText.includes("plannedStartAt")) fields.push(rangeStart);
    if (!objectText.includes("plannedEndAt")) fields.push(rangeEnd);
  }
  if (fields.length === 0) return objectText;
  return inject(objectText, fields);
}

function patchCall(src, openParen, kind) {
  const closeParen = matchParen(src, openParen);
  if (closeParen === -1) return null;
  const args = splitArgs(src, openParen, closeParen);
  const last = args.at(-1);
  if (!last || !last.includes("{")) return null;
  const brace = last.indexOf("{");
  const objectText = last.slice(brace);
  const patched = patchObject(objectText, kind);
  if (patched === objectText) return null;
  const nextLast = `${last.slice(0, brace)}${patched}`;
  const nextArgs = [...args.slice(0, -1), nextLast];
  const replacement = `(${nextArgs.join(",")})`;
  return { closeParen, replacement };
}

function findNamedCalls(src, name, kind, edits) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of src.matchAll(pattern)) {
    const openParen = match.index + match[0].length - 1;
    const patched = patchCall(src, openParen, kind);
    if (patched) edits.push({ openParen, ...patched });
  }
}

function findFactoryCalls(src, name, kind, edits) {
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  for (const match of src.matchAll(pattern)) {
    const factoryOpen = match.index + match[0].length - 1;
    const factoryClose = matchParen(src, factoryOpen);
    if (factoryClose === -1) continue;
    let i = factoryClose + 1;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== "(") continue;
    const patched = patchCall(src, i, kind);
    if (patched) edits.push({ openParen: i, ...patched });
  }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

let changed = 0;
for (const file of walk(root)) {
  const src = fs.readFileSync(file, "utf8");
  const edits = [];
  findNamedCalls(src, "createPhase", "phase", edits);
  findNamedCalls(src, "createTask", "task", edits);
  findNamedCalls(src, "createMilestone", "milestone", edits);
  findFactoryCalls(src, "makeCreatePhaseUseCase", "phase", edits);
  findFactoryCalls(src, "makeCreateTaskUseCase", "task", edits);
  findFactoryCalls(src, "makeCreateMilestoneUseCase", "milestone", edits);
  if (edits.length === 0) continue;
  edits.sort((a, b) => b.openParen - a.openParen);
  let next = src;
  for (const edit of edits) {
    next = `${next.slice(0, edit.openParen)}${edit.replacement}${next.slice(edit.closeParen + 1)}`;
  }
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log(`${path.relative(root, file)}: ${edits.length}`);
  }
}
console.log(`files ${changed}`);
