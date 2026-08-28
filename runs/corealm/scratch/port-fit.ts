import type { GearVisualsPort } from "../../../game/src/render/characterRig.js";
import * as equipmentVisuals from "../../../game/src/render/equipmentVisuals.js";

/** Proves `import * as equipmentVisuals` satisfies the rig's port with no adapter. */
export const port: GearVisualsPort = equipmentVisuals;
