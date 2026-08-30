import { boot } from "./app/boot.js";
import { bootProfileFor } from "./app/bootProfile.js";

const canvas = document.getElementById("viewport");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Corealm needs a <canvas id=\"viewport\">");
}

const profile = bootProfileFor(window.location);
if (profile.kind === "feature-lab") {
  document.title = "Corealm · Feature Lab";
  document.body.dataset["bootProfile"] = "feature-lab";
}

boot(canvas, { profile }).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error("Corealm failed to boot", error);
  const screen = document.getElementById("boot-screen");
  if (screen) {
    screen.classList.remove("hidden");
    screen.innerHTML = `<div class="boot-mark">COREALM</div><pre class="boot-error">${escapeHtml(message)}</pre>`;
  }
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
