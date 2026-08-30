const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.35;

function initialiseLocationMap(root) {
  if (!(root instanceof HTMLElement) || root.dataset.mapReady === "true") return;

  const viewport = root.querySelector("[data-map-viewport]");
  const stage = root.querySelector("[data-map-stage]");
  const expandButton = root.querySelector('[data-map-action="expand"]');
  const zoomInButton = root.querySelector('[data-map-action="in"]');
  const zoomOutButton = root.querySelector('[data-map-action="out"]');
  if (!(viewport instanceof HTMLElement) || !(stage instanceof HTMLElement)) return;

  root.dataset.mapReady = "true";
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drag;
  let expanded = false;
  let placeholder;

  const clampOffsets = () => {
    const { width, height } = viewport.getBoundingClientRect();
    const maxX = Math.max(0, width * (zoom - 1) / 2);
    const maxY = Math.max(0, height * (zoom - 1) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
  };

  const render = () => {
    clampOffsets();
    stage.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${zoom})`;
    root.style.setProperty("--marker-inverse", String(1 / zoom));
    root.dataset.mapZoom = zoom.toFixed(2);
    if (zoomInButton instanceof HTMLButtonElement) zoomInButton.disabled = zoom >= MAX_ZOOM;
    if (zoomOutButton instanceof HTMLButtonElement) zoomOutButton.disabled = zoom <= MIN_ZOOM;
  };

  const setZoom = (nextZoom, clientX, clientY) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (Math.abs(next - zoom) < 0.001) return;
    const rect = viewport.getBoundingClientRect();
    const focusX = Number.isFinite(clientX) ? clientX - rect.left - rect.width / 2 : 0;
    const focusY = Number.isFinite(clientY) ? clientY - rect.top - rect.height / 2 : 0;
    const ratio = next / zoom;
    offsetX = focusX - (focusX - offsetX) * ratio;
    offsetY = focusY - (focusY - offsetY) * ratio;
    zoom = next;
    render();
  };

  const reset = () => {
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    render();
  };

  const setExpanded = (next) => {
    if (expanded === next) return;
    const previousRect = viewport.getBoundingClientRect();
    expanded = next;
    if (expanded) {
      placeholder = document.createComment("corealm-location-map");
      root.before(placeholder);
      document.body.append(root);
    } else if (placeholder?.parentNode) {
      placeholder.replaceWith(root);
      placeholder = undefined;
    }
    root.classList.toggle("is-expanded", expanded);
    root.toggleAttribute("aria-modal", expanded);
    if (expanded) {
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "Corealm world map");
    } else {
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    }
    document.documentElement.classList.toggle("corealm-map-open", expanded);
    if (expandButton instanceof HTMLButtonElement) {
      expandButton.setAttribute("aria-pressed", String(expanded));
      expandButton.setAttribute("aria-label", expanded ? "Close expanded map" : "Expand map");
      expandButton.title = expanded ? "Close expanded map" : "Expand map";
    }
    requestAnimationFrame(() => {
      const nextRect = viewport.getBoundingClientRect();
      if (previousRect.width > 0 && previousRect.height > 0) {
        offsetX *= nextRect.width / previousRect.width;
        offsetY *= nextRect.height / previousRect.height;
      }
      render();
      viewport.focus({ preventScroll: true });
    });
  };

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    if (event.button !== 0 || target?.closest("button, a")) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX,
      offsetY,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
  });

  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    offsetX = drag.offsetX + event.clientX - drag.startX;
    offsetY = drag.offsetY + event.clientY - drag.startY;
    render();
  });

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    viewport.classList.remove("is-panning");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const action = target?.closest("[data-map-action]")?.dataset.mapAction;
    if (action === "in") setZoom(zoom * ZOOM_STEP);
    if (action === "out") setZoom(zoom / ZOOM_STEP);
    if (action === "reset") reset();
    if (action === "expand") setExpanded(!expanded);
    if (expanded && target?.closest("[data-map-marker]")) setExpanded(false);
  });

  root.addEventListener("keydown", (event) => {
    const panStep = 32;
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setExpanded(false);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom(zoom * ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      setZoom(zoom / ZOOM_STEP);
    } else if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      reset();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      offsetX += panStep;
      render();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      offsetX -= panStep;
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      offsetY += panStep;
      render();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      offsetY -= panStep;
      render();
    }
  });

  window.addEventListener("resize", render);
  render();
}

function initialiseMaps() {
  document.querySelectorAll("[data-location-map]").forEach(initialiseLocationMap);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseMaps, { once: true });
else initialiseMaps();
document.addEventListener("astro:page-load", initialiseMaps);
