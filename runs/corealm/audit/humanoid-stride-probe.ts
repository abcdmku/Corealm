/**
 * Measures the planted-foot ground speed the shared humanoid library's locomotion clips imply,
 * the same quantity `HUMANOID_JOG_IMPLIED_MPS` records for Jog_Fwd_Loop (5.92, which this probe
 * must reproduce to be trusted). Needed because retiming the jog to a reaver's authored
 * 2.1 m/s pursuit plays it at 0.35x — the reported "humanoid creatures slow motion run" — and
 * choosing Walk_Loop instead needs Walk_Loop's own implied speed.
 *
 * Runs in the browser off the dev server so three.js and the GLB pipeline are the production
 * ones. Foot speed is measured as the peak backward velocity of each foot bone relative to the
 * hips while that foot is at its lowest (planted): during stance the ground carries the foot
 * backward through the root frame at exactly the ground speed the clip depicts.
 *
 *   npx tsx runs/corealm/audit/humanoid-stride-probe.ts
 */
import { chromium } from "playwright";

const SERVER = "http://127.0.0.1:4200";

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage();

try {
  await page.goto(`${SERVER}/index.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const rows = await page.evaluate(async () => {
    // Vite's dev server resolves bare specifiers only inside its own module graph; /@id/ is its
    // escape hatch for exactly this kind of external driving.
    const three = await import(/* @vite-ignore */ "/@id/three");
    const { GLTFLoader } = await import(/* @vite-ignore */ "/@id/three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync("/assets/models/animation/animation_library_1.glb");
    const rig = gltf.scene;
    rig.updateMatrixWorld(true);

    const bones: Record<string, InstanceType<typeof three.Object3D>> = {};
    rig.traverse((node) => { bones[node.name] = node; });
    const hips = bones["pelvis"] ?? bones["Hips"] ?? bones["mixamorigHips"] ?? null;
    const feet = ["foot_l", "foot_r", "Foot_L", "Foot_R", "LeftFoot", "RightFoot"]
      .map((name) => bones[name]).filter((b): b is InstanceType<typeof three.Object3D> => Boolean(b));
    if (!hips || feet.length === 0) {
      return [{ clip: "ERROR", error: `hips=${Boolean(hips)} feet=${feet.length} names=${Object.keys(bones).slice(0, 40).join(",")}` }];
    }

    const mixer = new three.AnimationMixer(rig);
    const out: { clip: string; duration?: number; impliedMps?: number; error?: string }[] = [];
    for (const name of ["Walk_Loop", "Jog_Fwd_Loop", "Walk_Formal_Loop"]) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) { out.push({ clip: name, error: "missing" }); continue; }
      const action = mixer.clipAction(clip);
      mixer.stopAllAction();
      action.reset().play();

      const steps = 240;
      const dt = clip.duration / steps;
      const samples: { y: number; x: number; z: number }[][] = feet.map(() => []);
      const local = new three.Vector3();
      for (let index = 0; index <= steps; index += 1) {
        mixer.setTime(index * dt);
        rig.updateMatrixWorld(true);
        feet.forEach((foot, footIndex) => {
          foot.getWorldPosition(local);
          hips.worldToLocal(local);
          samples[footIndex]!.push({ y: local.y, x: local.x, z: local.z });
        });
      }
      // Planted = the foot's lowest quartile of height. Within it, the peak horizontal speed of
      // the foot through the pelvis frame is the ground speed the clip depicts, whatever axis the
      // rig calls forward. `pelvis` height wobbles a couple of centimetres over a cycle, which is
      // noise against a foot sweeping tens of centimetres.
      let implied = 0;
      samples.forEach((track) => {
        const heights = [...track].sort((a, b) => a.y - b.y);
        const plantY = heights[Math.floor(heights.length * 0.25)]!.y;
        for (let index = 1; index < track.length; index += 1) {
          const a = track[index - 1]!;
          const b = track[index]!;
          if (Math.max(a.y, b.y) > plantY + 0.02) continue;
          const speed = Math.hypot(a.x - b.x, a.z - b.z) / dt;
          implied = Math.max(implied, speed);
        }
      });
      out.push({ clip: name, duration: Math.round(clip.duration * 1000) / 1000, impliedMps: Math.round(implied * 100) / 100 });
    }
    return out;
  });

  for (const row of rows) {
    console.log(row.error
      ? `${row.clip}: ${row.error}`
      : `${row.clip}: duration ${row.duration}s, implied ${row.impliedMps} m/s`);
  }
} finally {
  await page.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}
