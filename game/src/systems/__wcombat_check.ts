// TEMPORARY. Deleted before hand-off. Proves the injected ports accept the real systems.
import type { ActivitySystem } from "./activity.js";
import type { InventorySystem } from "./inventory.js";
import type { EquipmentSystem } from "./equipment.js";
import type { Movement } from "./movement.js";
import type { EntityStore } from "../world/entities.js";
import type { Navigation } from "./navigation.js";
import type {
  CombatActivityPort, CombatEntityPort, CombatEquipmentPort, CombatInventoryPort, CombatMovementPort,
} from "./combat.js";
import type { HealthEquipmentPort } from "./health.js";
import type { DeathActivityPort } from "./death.js";
import type { EnemyNavPort } from "./enemyAI.js";
import type { ProductionActivityPort, ProductionDriver } from "./production.js";
import type { ActivityDriver } from "./activity.js";

declare const store: EntityStore;
declare const inv: InventorySystem;
declare const eq: EquipmentSystem;
declare const mv: Movement;
declare const act: ActivitySystem;
declare const nav: Navigation;
declare const drv: ProductionDriver;

export const a: CombatEntityPort = store;
export const b: CombatInventoryPort = inv;
export const c: CombatEquipmentPort = eq;
export const d: CombatMovementPort = mv;
export const e: CombatActivityPort = act;
export const f: HealthEquipmentPort = eq;
export const g: DeathActivityPort = act;
export const h: EnemyNavPort = nav;
export const i: ProductionActivityPort = act;
export const j: ActivityDriver = drv;
