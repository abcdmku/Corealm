import path from "node:path";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { runSmokeTest } from "./smoke-test.js";
import { runPlayScenario } from "./play-game.js";
import { captureScreenshot } from "./screenshot.js";
import { argValue, prepareRun, repoRoot, resolveInside, runsRoot, safeName } from "./lib/paths.js";

const [command = "help", ...args] = process.argv.slice(2);

switch (command) {
  case "build":
  case "init":
    await initRun(args);
    break;
  case "test": {
    const report = await runSmokeTest(requireValue(argValue(args, "--run") ?? args[0], "Usage: game-agent test --run runs/<id>"));
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors }, null, 2));
    if (!report.passed) process.exitCode = 1;
    break;
  }
  case "play": {
    const report = await runPlayScenario(
      requireValue(argValue(args, "--run"), "Usage: game-agent play --run runs/<id> --scenario <file>"),
      requireValue(argValue(args, "--scenario") ?? args[0], "Usage: game-agent play --run runs/<id> --scenario <file>"),
    );
    console.log(JSON.stringify({ passed: report.passed, actions: report.actions.length, screenshots: report.screenshots, errors: report.errors }, null, 2));
    if (!report.passed) process.exitCode = 1;
    break;
  }
  case "screenshot": {
    const file = await captureScreenshot(
      requireValue(argValue(args, "--run"), "Usage: game-agent screenshot --run runs/<id> [--name checkpoint]"),
      argValue(args, "--name") ?? "current",
      argValue(args, "--preset"),
    );
    console.log(file);
    break;
  }
  case "critic-pack":
    console.log(await makeCriticPacket(requireValue(argValue(args, "--run") ?? args[0], "Usage: game-agent critic-pack --run runs/<id>")));
    break;
  default:
    printHelp();
}

async function initRun(values: string[]): Promise<void> {
  const briefCandidate = values.find((value) => !value.startsWith("--"));
  if (!briefCandidate) throw new Error("Usage: game-agent build <brief-file> [--id run-id]");
  const briefPath = resolveInside(repoRoot, briefCandidate);
  const info = await stat(briefPath);
  if (!info.isFile()) throw new Error(`Brief is not a file: ${briefCandidate}`);
  const id = safeName(argValue(values, "--id") ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${path.basename(briefPath, path.extname(briefPath))}`);
  const runDir = await prepareRun(path.join("runs", id));
  await copyFile(briefPath, path.join(runDir, "brief.md"));
  await writeFile(path.join(runDir, "status.md"), "# Status\n\n- [x] Brief recorded\n- [ ] Fresh PRD draft\n- [ ] Root PRD review\n- [ ] Foundation passes Chromium smoke test\n- [ ] Build round integrated\n- [ ] Play and critique loop complete\n", "utf8");
  console.log(`Prepared ${path.relative(repoRoot, runDir)}.`);
  console.log(`Root next step: spawn a fresh PRD agent with skills/prd.md and ${path.relative(repoRoot, path.join(runDir, "brief.md"))}.`);
}

async function makeCriticPacket(runCandidate: string): Promise<string> {
  const runDir = await prepareRun(runCandidate);
  const screenshots = (await readdir(path.join(runDir, "screenshots"))).filter((file) => /\.(png|jpe?g)$/i.test(file)).sort();
  const results = (await readdir(path.join(runDir, "test-results"))).filter((file) => file.endsWith(".json")).sort();
  const prdPath = path.join(runDir, "PRD.md");
  let prd = "PRD.md is missing.";
  try {
    prd = await readFile(prdPath, "utf8");
  } catch {}
  const packet = [
    "# Critic packet",
    "",
    "Use `skills/critic.md`. Review only. Do not edit code.",
    "",
    "## Approved PRD",
    "",
    prd,
    "",
    "## Browser evidence",
    "",
    ...results.map((file) => `- test-results/${file}`),
    "",
    "## Screenshots",
    "",
    ...screenshots.map((file) => `- screenshots/${file}`),
    "",
  ].join("\n");
  const output = path.join(runDir, "critic-packet.md");
  await writeFile(output, packet, "utf8");
  return path.relative(repoRoot, output);
}

function printHelp(): void {
  console.log(`game-agent commands:
  build <brief-file> [--id run-id]  prepare a run and print the fresh-PRD handoff
  test --run runs/id                run the Chromium health check
  play --run runs/id --scenario f  run state-backed gameplay actions
  screenshot --run runs/id         capture a repeatable browser view
  critic-pack --run runs/id        assemble PRD and evidence paths for a critic`);
}

function requireValue(value: string | undefined, usage: string): string {
  if (!value) throw new Error(usage);
  return value;
}
