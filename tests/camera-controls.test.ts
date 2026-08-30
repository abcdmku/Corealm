import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CAMERA } from "../game/src/app/config.js";
import { OrbitCamera } from "../game/src/render/camera.js";
import { DEFAULT_SETTINGS } from "../game/src/ui/settings.js";

describe("camera controls", () => {
  it("caps player zoom-out at 11 metres without clamping authored shots", () => {
    const camera = new OrbitCamera(new THREE.PerspectiveCamera());

    expect(camera.distance).toBe(11);
    camera.zoom(-2);
    camera.zoom(100);
    expect(camera.distance).toBe(11);
    expect(camera.distance).toBe(CAMERA.maxDistance);

    camera.setPose(0, CAMERA.defaultPitch, 34);
    expect(camera.distance).toBe(CAMERA.maxAuthoredDistance);
  });

  it("raises the camera on a downward drag with the default preference", () => {
    const camera = new OrbitCamera(new THREE.PerspectiveCamera());
    camera.invertPitch = DEFAULT_SETTINGS.invertCameraY;
    const initialPitch = camera.pitch;

    // Mouse input sends a negative pitch delta when the pointer moves down.
    camera.rotate(0, -0.1);

    expect(camera.pitch).toBeGreaterThan(initialPitch);
  });
});
