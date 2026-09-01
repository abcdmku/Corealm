/**
 * Audits the shipped miniboss and weapon GLBs, from the files rather than the build report.
 *
 * The build already checks most of this on the way out; this re-reads what is on disk because the
 * failure modes worth catching are the ones that survive a green build: a leaked seventh clip, a
 * root translation track the strip missed, a texture that quietly failed to embed. Exits non-zero
 * on any violation.
 *
 *   npx tsx tools/minibosses/audit.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBounds, Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_DIR = path.join(repoRoot, "game", "public", "assets", "models", "miniboss");

const CANONICAL_CLIPS = ["Idle", "Walk", "Run", "Attack", "Hit", "Death"];
const MINIBOSSES = ["miniboss_galeskin", "miniboss_mossbound", "miniboss_tideworn", "miniboss_cinderwake"];
// Height/length bands: a miniboss should stand 1.5-3 m; the weapons were normalized to 1.25 m and
// 1.75 m and anything outside a tight band means the scale correction regressed.
const WEAPONS = [
  { id: "miniboss_sword", longest: [1.1, 1.3] },
  { id: "miniboss_staff", longest: [1.6, 1.9] },
];

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR));
let failures = 0;

function check(condition, label) {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

function dims(document) {
  const bounds = getBounds(document.getRoot().listScenes()[0]);
  return [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]);
}

for (const id of MINIBOSSES) {
  const document = await io.read(path.join(MODEL_DIR, `${id}.glb`));
  const root = document.getRoot();
  console.log(id);

  const clips = root.listAnimations().map((clip) => clip.getName());
  check(
    clips.slice().sort().join(",") === CANONICAL_CLIPS.slice().sort().join(","),
    `clips are exactly the canonical six, got [${clips.join(", ")}]`,
  );

  // The root bone is the joint whose parent is not itself a joint; a translation channel on it is
  // baked root motion the strip should have removed, and it makes the creature skate.
  const joints = new Set(root.listSkins().flatMap((skin) => skin.listJoints()));
  const rootJoints = [...joints].filter((joint) => !joints.has(joint.getParentNode?.() ?? null));
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const isRoot = rootJoints.includes(channel.getTargetNode());
      check(
        !(isRoot && channel.getTargetPath() === "translation"),
        `${animation.getName()} carries a root translation track`,
      );
    }
  }

  const [x, y, z] = dims(document);
  check(y >= 1.5 && y <= 3, `height ${y.toFixed(2)} m within 1.5-3 m`);
  check(root.listTextures().length > 0, "has an embedded texture");
  for (const texture of root.listTextures()) {
    check((texture.getImage()?.byteLength ?? 0) > 1024, `texture ${texture.getName()} has embedded bytes`);
  }
  console.log(`  ok: ${clips.length} clips, ${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)} m, ${root.listTextures().length} texture(s)`);
}

for (const { id, longest } of WEAPONS) {
  const document = await io.read(path.join(MODEL_DIR, `${id}.glb`));
  const root = document.getRoot();
  console.log(id);

  check(root.listAnimations().length === 0, `no animations, got ${root.listAnimations().length}`);
  const [x, y, z] = dims(document);
  const max = Math.max(x, y, z);
  check(max >= longest[0] && max <= longest[1], `longest axis ${max.toFixed(3)} m within ${longest[0]}-${longest[1]} m`);
  check(max === y, "longest axis is +Y (shaft up)");
  check(root.listTextures().length > 0, "has an embedded texture");
  for (const texture of root.listTextures()) {
    check((texture.getImage()?.byteLength ?? 0) > 1024, `texture ${texture.getName()} has embedded bytes`);
  }
  console.log(`  ok: ${x.toFixed(2)} x ${y.toFixed(2)} x ${z.toFixed(2)} m, ${root.listTextures().length} texture(s)`);
}

if (failures > 0) {
  console.error(`\n${failures} audit failure(s)`);
  process.exitCode = 1;
} else {
  console.log("\nall miniboss GLBs pass");
}
