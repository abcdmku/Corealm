import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { EquipmentBonuses, ItemDef, ItemId } from "../game/src/contracts.js";
import { EQUIPMENT, KITS } from "../game/src/content/equipment.js";
import { computeMaxHealth, createInitialState, setSkillLevel } from "../game/src/state/store.js";
import {
  GEAR_APPEARANCE_IDS, GEAR_ASSET_GAPS, VISIBLE_EQUIP_SLOTS,
  applyGearAppearance, gearAppearance, gearAppearanceParts, weaponAttachment, weaponSocket,
} from "../game/src/render/equipmentVisuals.js";
import { iconShapeFor } from "../game/src/ui/itemIcons.js";

/**
 * The equipment ladder, frozen as tests.
 *
 * `KITS` (content/equipment.ts) was exported with a comment saying it existed "so a test can
 * re-check the totals in the header comment without re-deriving them by hand", and then went
 * unimported for the whole of Phase 1: the 57-row gear table that PRD 2.3's health column and PRD
 * 2.4's damage column are solved from had zero test coverage. A live sweep found the numbers
 * correct; nothing in CI would have caught them moving.
 *
 * The appearance half is checked the same way. The failure this guards against is specific and
 * cheap to ship: a typo in an asset id resolves to nothing at load time, `AssetRegistry.load`
 * rejects, the rig swallows it, and the item is silently invisible with no error anywhere. So every
 * asset id the table can produce — for BOTH body variants — is checked against the manifest.
 */

const BY_ID = new Map<ItemId, ItemDef>(EQUIPMENT.map((def) => [def.id, def]));

function kitTotals(kit: keyof typeof KITS): EquipmentBonuses {
  const totals: EquipmentBonuses = {
    accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
  };
  for (const id of KITS[kit] ?? []) {
    const bonuses = BY_ID.get(id)?.equip?.bonuses;
    if (!bonuses) throw new Error(`KITS.${kit} names ${id}, which is not an equippable row`);
    totals.accuracy += bonuses.accuracy;
    totals.power += bonuses.power;
    totals.armour += bonuses.armour;
    totals.magicAccuracy += bonuses.magicAccuracy;
    totals.magicPower += bonuses.magicPower;
    totals.magicArmour += bonuses.magicArmour;
    totals.vitality += bonuses.vitality;
  }
  return totals;
}

describe("the gear ladder", () => {
  it("has 57 rows, one per id, all of them equippable", () => {
    expect(EQUIPMENT).toHaveLength(57);
    expect(BY_ID.size).toBe(57);
    for (const def of EQUIPMENT) {
      expect(def.equip, `${def.id} has no equip block`).toBeDefined();
      expect(def.category).toBe("equipment");
    }
  });

  it("dresses exactly one item per slot in each of the six kits", () => {
    for (const kit of Object.keys(KITS)) {
      const ids = KITS[kit] ?? [];
      const slots = ids.map((id) => BY_ID.get(id)?.equip?.slot);
      expect(ids, kit).toHaveLength(9);
      expect(new Set(slots).size, `${kit} wears two items in one slot`).toBe(9);
    }
  });

  // The header block of content/equipment.ts states these, and every one of them is solved from a
  // worked example in the PRD rather than chosen. Melee kits also carry 1 (t5) and 2 (t10)
  // magicAccuracy off their pendants, which the header does not quote; asserted here so the full
  // seven fields are pinned, not just the five that were written down.
  it("sums to the totals the header solves from the PRD", () => {
    expect(kitTotals("melee_t1")).toEqual({
      accuracy: 11, power: 8, armour: 16, magicAccuracy: 0, magicPower: 0, magicArmour: 5, vitality: 6,
    });
    expect(kitTotals("melee_t5")).toEqual({
      accuracy: 23, power: 14, armour: 33, magicAccuracy: 1, magicPower: 0, magicArmour: 12, vitality: 14,
    });
    expect(kitTotals("melee_t10")).toEqual({
      accuracy: 42, power: 26, armour: 58, magicAccuracy: 2, magicPower: 0, magicArmour: 19, vitality: 16,
    });
    expect(kitTotals("magic_t1")).toEqual({
      accuracy: 0, power: 0, armour: 3, magicAccuracy: 12, magicPower: 6, magicArmour: 13, vitality: 4,
    });
    expect(kitTotals("magic_t5")).toEqual({
      accuracy: 0, power: 2, armour: 4, magicAccuracy: 24, magicPower: 14, magicArmour: 28, vitality: 10,
    });
    expect(kitTotals("magic_t10")).toEqual({
      accuracy: 0, power: 4, armour: 8, magicAccuracy: 47, magicPower: 32, magicArmour: 50, vitality: 12,
    });
  });

  it("reproduces PRD 2.3's derived-health column at the levels it quotes", () => {
    const health = (melee: number, magic: number, kit: keyof typeof KITS): number => {
      const state = createInitialState(1337, 0);
      setSkillLevel(state, "melee", melee);
      setSkillLevel(state, "magic", magic);
      return computeMaxHealth(state, kitTotals(kit).vitality);
    };
    expect(health(10, 1, "melee_t1")).toBe(41);
    expect(health(12, 5, "melee_t5")).toBe(58);
    expect(health(18, 8, "melee_t10")).toBe(75);
  });

  it("keeps armour out of power, which is what makes the PRD's max-hit table reproduce", () => {
    // PRD 2.4's worked rows quote weapon-only gearPower. If a single armour row ever gains power,
    // "Melee 18, tier 10 kit -> maxHit 12" stops holding.
    for (const def of EQUIPMENT) {
      const equip = def.equip;
      if (!equip || equip.slot === "mainHand") continue;
      expect(equip.bonuses.power, `${def.id} gives power from a non-weapon slot`).toBe(0);
    }
  });
});

// -------------------------------------------------------------------------- appearance

interface ManifestAsset { id: string }
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../game/public/assets/manifest.json", import.meta.url)), "utf8"),
) as { assets: ManifestAsset[] };
const MANIFEST_IDS = new Set(manifest.assets.map((asset) => asset.id));

describe("gear appearance", () => {
  it("covers every id in the content table and nothing else", () => {
    expect([...GEAR_APPEARANCE_IDS].sort()).toEqual(EQUIPMENT.map((def) => def.id).sort());
  });

  it("agrees with content on which slot each item goes in", () => {
    for (const def of EQUIPMENT) {
      for (const part of gearAppearanceParts(def.id)) {
        expect(part.slot, def.id).toBe(def.equip?.slot);
      }
    }
  });

  // This is the check that stops a typo shipping as an invisible sword: a bad asset id fails
  // AssetRegistry.load at runtime, the rig catches it, and the player just wears nothing.
  it("names only assets that exist in the manifest, for both body variants", () => {
    for (const body of ["male", "female"] as const) {
      for (const def of EQUIPMENT) {
        for (const part of gearAppearanceParts(def.id, body)) {
          expect(MANIFEST_IDS.has(part.assetId), `${def.id} (${body}) -> ${part.assetId}`).toBe(true);
        }
      }
    }
  });

  it("shows something for every visible slot except the declared gaps", () => {
    const empty = EQUIPMENT
      .filter((def) => def.equip && VISIBLE_EQUIP_SLOTS.includes(def.equip.slot))
      .filter((def) => gearAppearance(def.id) === null)
      .map((def) => def.id);
    // Exactly the three staffs. There is no staff mesh in the 213-asset library and a sword in a
    // mage's hand would misreport what is held, so they render nothing on purpose.
    expect(empty.sort()).toEqual(Object.keys(GEAR_ASSET_GAPS).sort());
    expect(empty).toHaveLength(3);
  });

  it("leaves rings and pendants unrendered, because they are not visible slots", () => {
    for (const def of EQUIPMENT) {
      if (def.equip?.slot !== "accessory1" && def.equip?.slot !== "accessory2") continue;
      expect(gearAppearanceParts(def.id)).toHaveLength(0);
    }
    expect(VISIBLE_EQUIP_SLOTS).not.toContain("accessory1");
    expect(VISIBLE_EQUIP_SLOTS).not.toContain("accessory2");
  });

  it("grows the silhouette with tier and swaps the body variant", () => {
    const t1 = gearAppearance("grithe_sword");
    const t10 = gearAppearance("kaldite_sword");
    expect(t1?.scale).toBeLessThan(t10?.scale ?? 0);
    expect(t1?.tint).not.toBe(t10?.tint);
    // Tier 5 and 10 body pieces carry a pauldron; tier 1 does not. That is the growth.
    expect(gearAppearanceParts("grithe_cuirass")).toHaveLength(1);
    expect(gearAppearanceParts("kaldite_plate")).toHaveLength(2);
    expect(gearAppearance("kaldite_plate", "female")?.assetId).toBe("outfit_female_ranger_chest");
    expect(gearAppearance("wightshroud_robe", "male")?.assetId).toBe("outfit_male_peasant_chest");
  });

  it("attaches weapons to bones and armour to skin, and never scales a skinned part", () => {
    for (const def of EQUIPMENT) {
      for (const part of gearAppearanceParts(def.id)) {
        const expected = def.equip?.slot === "mainHand" || def.equip?.slot === "offHand" ? "bone" : "skin";
        expect(part.attach, def.id).toBe(expected);
        if (part.attach === "skin") expect(part.scale, def.id).toBeUndefined();
        else expect(weaponSocket(part.assetId), `${def.id} has no socket`).not.toBeNull();
      }
    }
  });
});

describe("weapon sockets", () => {
  it("puts the sword's grip in the right fist and the shield on the left hand", () => {
    // Measured in hand_r local space on base_male.glb: fist centre (-0.010, 0.085, 0.000), grip
    // axis = local +Z, and the sword's grip centre sits at asset y = -0.10.
    expect(weaponSocket("sword")).toEqual({
      bone: "hand_r", position: [-0.01, 0.085, 0.1], rotation: [Math.PI / 2, 0, 0], scale: 1,
    });
    expect(weaponSocket("shield")?.bone).toBe("hand_l");
    expect(weaponSocket("pickaxe")?.rotation[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(weaponSocket("staff")).toBeNull();
  });

  it("shrinks the grip offset with the part, so a dagger does not float off the pommel", () => {
    const dagger = gearAppearance("grithe_dagger");
    expect(dagger).not.toBeNull();
    const socket = dagger ? weaponAttachment(dagger) : null;
    expect(socket).not.toBeNull();
    // 0.62 * tierSilhouetteScale(1) = 0.558; the uncompensated 0.100 m offset would put the grip
    // 4.4 cm from the fist centre, past its 3.8 cm half-span.
    expect(socket?.scale).toBeCloseTo(0.558, 3);
    expect(socket?.position[2]).toBeCloseTo(0.056, 3);
    expect(socket?.position[0]).toBeCloseTo(-0.01, 10);
  });
});

describe("tinting", () => {
  it("clones the material instead of repainting every other user of the asset", () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const source = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const attached = source.clone();
    const appearance = gearAppearance("kaldite_plate");
    expect(appearance).not.toBeNull();
    if (appearance) applyGearAppearance(attached, appearance);

    const painted = attached.material as THREE.MeshStandardMaterial;
    expect(painted).not.toBe(shared);
    expect(painted.color.getHex()).toBe(appearance?.tint);
    // The NPCs in Coldbrace wear the same peasant and ranger parts out of the same asset cache.
    expect(shared.color.getHex()).toBe(0xffffff);
  });

  it("puts Kaldite's garnet in the emissive channel, since the weapon GLBs carry one material", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const sword = gearAppearance("kaldite_sword");
    expect(sword?.accent).toBeDefined();
    if (sword) applyGearAppearance(mesh, sword);
    const painted = mesh.material as THREE.MeshStandardMaterial;
    expect(painted.emissive.getHex()).toBe(sword?.accent);
    expect(painted.emissiveIntensity).toBeLessThan(0.3);
    // Grithe and Corven have no accent, so they must not gain an emissive at all.
    const grithe = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const grey = gearAppearance("grithe_sword");
    if (grey) applyGearAppearance(grithe, grey);
    expect((grithe.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });
});

describe("item icons", () => {
  // Slot alone drew 21 of the 57 rows with the wrong silhouette, including a sword glyph for the
  // Cairnpine Staff in the Worn panel.
  it("draws the archetype, not the slot", () => {
    expect(iconShapeFor(BY_ID.get("cairnpine_staff"))).toBe("staff");
    expect(iconShapeFor(BY_ID.get("kaldite_dagger"))).toBe("dagger");
    expect(iconShapeFor(BY_ID.get("garnet_focus"))).toBe("orb");
    expect(iconShapeFor(BY_ID.get("storm_charm"))).toBe("amulet");
    expect(iconShapeFor(BY_ID.get("grithe_pendant"))).toBe("amulet");
    expect(iconShapeFor(BY_ID.get("wightshroud_robe"))).toBe("robe");
    expect(iconShapeFor(BY_ID.get("marchhide_hood"))).toBe("hood");
  });

  it("still falls back to the slot for everything else", () => {
    expect(iconShapeFor(BY_ID.get("kaldite_sword"))).toBe("sword");
    expect(iconShapeFor(BY_ID.get("cairnpine_shield"))).toBe("shield");
    expect(iconShapeFor(BY_ID.get("storm_ring"))).toBe("ring");
    expect(iconShapeFor(BY_ID.get("kaldite_helm"))).toBe("helm");
    expect(iconShapeFor(BY_ID.get("kaldite_boots"))).toBe("boot");
  });

  it("gives every one of the 57 rows a shape", () => {
    for (const def of EQUIPMENT) expect(iconShapeFor(def), def.id).toBeTruthy();
  });
});
