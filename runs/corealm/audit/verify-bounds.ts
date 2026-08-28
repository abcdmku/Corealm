/**
 * Independent re-derivation of every shipped GLB's world-space bounding box.
 * Does NOT use @gltf-transform/functions getBounds (the audit script used that);
 * walks the scene graph itself, composes TRS matrices by hand and transforms
 * every POSITION element, so a disagreement with runs/corealm/audit/glb-bounds.json
 * would be a real disagreement and not the same code twice.
 */
import { NodeIO, type Node, type Scene } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import fs from "node:fs";
import path from "node:path";

type M16 = number[];

function identity(): M16 {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}
// column-major, same convention as glTF node.matrix
function mul(a: M16, b: M16): M16 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}
function trs(t: number[], q: number[], s: number[]): M16 {
  const [x, y, z, w] = q as [number, number, number, number];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s as [number, number, number];
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}
function apply(m: M16, p: number[]): [number, number, number] {
  const [x, y, z] = p as [number, number, number];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];

function visit(node: Node, parent: M16, min: number[], max: number[]): void {
  const local = trs(node.getTranslation() as number[], node.getRotation() as number[], node.getScale() as number[]);
  const world = mul(parent, local);
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const w = apply(world, el);
        for (let k = 0; k < 3; k++) {
          if (w[k]! < min[k]!) min[k] = w[k]!;
          if (w[k]! > max[k]!) max[k] = w[k]!;
        }
      }
    }
  }
  for (const child of node.listChildren()) visit(child, world, min, max);
}

function boundsOf(scene: Scene): { min: number[]; max: number[] } {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const node of scene.listChildren()) visit(node, identity(), mn, mx);
  return { min: mn, max: mx };
}

const base = "game/public/assets";
const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8")) as {
  assets: Array<{ id: string; file: string; size: { x: number; y: number; z: number } }>;
};
const audit = JSON.parse(fs.readFileSync("runs/corealm/audit/glb-bounds.json", "utf8")) as Array<{
  id: string; minY: number | null; maxY: number | null; sizeY: number | null;
}>;
const auditById = new Map(audit.map((a) => [a.id, a]));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const only = process.argv.slice(2);
const rows: Array<Record<string, unknown>> = [];
let worstDelta = 0;
let worstId = "";
let checked = 0;
let empty = 0;
for (const a of manifest.assets) {
  if (only.length && !only.includes(a.id)) continue;
  const doc = await io.read(path.join(base, a.file));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  const b = boundsOf(scene);
  const finite = Number.isFinite(b.min[1]);
  const au = auditById.get(a.id);
  if (!finite) {
    empty++;
    rows.push({ id: a.id, mine: null, audit: au?.minY ?? null, note: "no POSITION data in shipped GLB" });
    continue;
  }
  const mineMinY = +b.min[1]!.toFixed(4);
  const mineSizeY = +(b.max[1]! - b.min[1]!).toFixed(4);
  const dMin = au && au.minY !== null ? Math.abs(mineMinY - au.minY) : NaN;
  const dSize = Math.abs(mineSizeY - a.size.y);
  checked++;
  if (Number.isFinite(dMin) && dMin > worstDelta) { worstDelta = dMin; worstId = a.id; }
  rows.push({ id: a.id, mineMinY, auditMinY: au?.minY ?? null, dMin, mineSizeY, manifestSizeY: a.size.y, dSize });
}
const bad = rows.filter((r) => typeof r.dMin === "number" && (r.dMin as number) > 0.0002);
const badSize = rows.filter((r) => typeof r.dSize === "number" && (r.dSize as number) > 0.0011);
console.log(JSON.stringify({ checked, empty, worstId, worstDelta, minYMismatches: bad.length, sizeYMismatches: badSize.length }, null, 1));
for (const r of [...bad, ...badSize].slice(0, 20)) console.log(JSON.stringify(r));
if (only.length) for (const r of rows) console.log(JSON.stringify(r));
fs.writeFileSync("/tmp/verify-bounds.json", JSON.stringify(rows, null, 1));
