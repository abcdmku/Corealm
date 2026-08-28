import path from "node:path";
import { readFile } from "node:fs/promises";
import { gameRoot, resolveInside } from "./lib/paths.js";

const fileArg = process.argv[2];
if (!fileArg) throw new Error("Usage: tsx tools/inspect-glb.ts game/public/assets/model.glb");
const file = resolveInside(path.join(gameRoot, "public", "assets"), fileArg);
const bytes = await readFile(file);

if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
  throw new Error("Not a GLB file: missing glTF header");
}

const version = bytes.readUInt32LE(4);
const declaredLength = bytes.readUInt32LE(8);
if (declaredLength !== bytes.length) throw new Error(`GLB length mismatch: header ${declaredLength}, file ${bytes.length}`);

let offset = 12;
let json: Record<string, unknown> | undefined;
const chunks: Array<{ type: string; bytes: number }> = [];
while (offset + 8 <= bytes.length) {
  const length = bytes.readUInt32LE(offset);
  const type = bytes.toString("ascii", offset + 4, offset + 8);
  const start = offset + 8;
  const end = start + length;
  if (end > bytes.length) throw new Error("GLB chunk extends past the file length");
  chunks.push({ type, bytes: length });
  if (type === "JSON") json = JSON.parse(bytes.toString("utf8", start, end).trim()) as Record<string, unknown>;
  offset = end;
}

if (!json) throw new Error("GLB has no JSON chunk");
const named = (key: string): string[] => {
  const values = json?.[key];
  if (!Array.isArray(values)) return [];
  return values.map((value, index) => {
    if (!value || typeof value !== "object") return `${key}-${index}`;
    const name = (value as Record<string, unknown>).name;
    return typeof name === "string" && name ? name : `${key}-${index}`;
  });
};

console.log(JSON.stringify({
  file: path.relative(gameRoot, file),
  version,
  bytes: bytes.length,
  chunks,
  scenes: named("scenes"),
  nodes: named("nodes"),
  meshes: named("meshes"),
  animations: named("animations"),
}, null, 2));

