import { describe, expect, it } from "vitest";
import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type FeatureLabPreset,
  type Vec3,
} from "../game/src/contracts.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { ENEMIES, enemyIdFor } from "../game/src/content/enemies.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { QUESTS } from "../game/src/content/quests.js";
import { REGIONS } from "../game/src/content/regions.js";
import { SKILLS } from "../game/src/content/skills.js";
import { SPELLS } from "../game/src/content/spells.js";
import {
  FEATURE_LAB_CATALOG,
  createFeatureLabEntity,
} from "../game/src/featureLab/catalog.js";
import { FEATURE_LAB_STRUCTURE_CATALOG } from "../game/src/featureLab/structures.js";
import { npcOutfitParts } from "../game/src/render/characterAppearances.js";
import {
  COMPOSITION_IDS,
  KIT_IDS,
  PREFAB_IDS,
} from "../game/src/render/buildings.js";

const NPC_SOURCES = REGIONS.flatMap((region) => (
  region.settlement.npcs.map((npc) => ({
    region,
    settlement: region.settlement,
    npc,
  }))
));

const CREATURE_SOURCES = REGIONS.flatMap((region) => {
  const surface = region.enemyGroups.map((group) => ({
    regionId: region.id,
    dungeonName: null as string | null,
    group,
  }));
  const dungeon = region.dungeon;
  return dungeon === undefined
    ? surface
    : [
      ...surface,
      ...dungeon.enemyGroups.map((group) => ({
        regionId: dungeon.id,
        dungeonName: dungeon.name,
        group,
      })),
    ];
});

const ENEMY_BY_ID = new Map(ENEMIES.map((enemy) => [enemy.id, enemy] as const));

describe("the production-derived feature-lab catalog", () => {
  it("contains every NPC stand once, in production region order", () => {
    expect(FEATURE_LAB_CATALOG.targets.npc).toEqual(NPC_SOURCES.map(({ region, npc }) => ({
      id: npc.id,
      label: npc.name,
      kind: "npc",
      tier: region.tier,
    })));
    expect(new Set(FEATURE_LAB_CATALOG.targets.npc.map((preset) => preset.id)).size)
      .toBe(FEATURE_LAB_CATALOG.targets.npc.length);
  });

  it("contains every surface and dungeon creature group once", () => {
    expect(FEATURE_LAB_CATALOG.targets.creature).toEqual(CREATURE_SOURCES.map((source) => ({
      id: source.dungeonName === null
        ? source.group.id
        : `${source.regionId}:${source.group.id}`,
      label: `${source.group.name} (tier ${source.group.tier})${
        source.dungeonName === null ? "" : ` - ${source.dungeonName}`
      }`,
      kind: "creature",
      tier: source.group.tier,
    })));
    expect(new Set(FEATURE_LAB_CATALOG.targets.creature.map((preset) => preset.id)).size)
      .toBe(FEATURE_LAB_CATALOG.targets.creature.length);

    for (const { group } of CREATURE_SOURCES) {
      const enemy = ENEMY_BY_ID.get(group.id) ?? ENEMY_BY_ID.get(enemyIdFor(group.family, group.tier));
      expect(enemy, `${group.id} has no production ENEMIES stat block`).toBeDefined();
    }
  });

  it("groups every and only equippable ALL_ITEMS row under its canonical slot", () => {
    const expected = EQUIP_SLOTS.map((slot) => ({
      slot,
      label: titleCaseIdentifier(slot),
      items: ALL_ITEMS
        .filter((item) => item.equip?.slot === slot)
        .map((item) => ({ id: item.id, label: `${item.name} (tier ${item.tier})` })),
    }));
    expect(FEATURE_LAB_CATALOG.equipment).toEqual(expected);

    const catalogIds = FEATURE_LAB_CATALOG.equipment.flatMap((group) => group.items.map((item) => item.id));
    const sourceIds = ALL_ITEMS.filter((item) => item.equip !== undefined).map((item) => item.id);
    expect([...catalogIds].sort()).toEqual([...sourceIds].sort());
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
  });

  it("uses the complete canonical skill order and spell table", () => {
    expect(FEATURE_LAB_CATALOG.skills).toEqual(SKILL_IDS.map((id) => ({
      id,
      label: SKILLS[id].name,
    })));
    expect(FEATURE_LAB_CATALOG.spells).toEqual(SPELLS.map((spell) => ({
      id: spell.id,
      label: `${spell.name} - ${spell.element} ${spell.rung}`,
    })));
    expect(new Set(FEATURE_LAB_CATALOG.skills.map((skill) => skill.id)).size).toBe(SKILL_IDS.length);
    expect(new Set(FEATURE_LAB_CATALOG.spells.map((spell) => spell.id)).size).toBe(SPELLS.length);
  });

  it("uses the production-derived structure catalog without dropping any recipe family", () => {
    expect(FEATURE_LAB_CATALOG.structures).toEqual(FEATURE_LAB_STRUCTURE_CATALOG);
    expect(FEATURE_LAB_CATALOG.structures.prefabs.map((row) => row.id)).toEqual(PREFAB_IDS);
    expect(FEATURE_LAB_CATALOG.structures.compositions.map((row) => row.id)).toEqual(COMPOSITION_IDS);
    expect(FEATURE_LAB_CATALOG.structures.kits.map((row) => row.id)).toEqual(KIT_IDS);

    for (const rows of [
      FEATURE_LAB_CATALOG.structures.prefabs,
      FEATURE_LAB_CATALOG.structures.compositions,
      FEATURE_LAB_CATALOG.structures.kits,
    ]) {
      expect(rows.every((row) => row.label.trim().length > 0)).toBe(true);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    }
  });
});

describe("createFeatureLabEntity", () => {
  it("reproduces the regionBuilder NPC shape for every authored stand", () => {
    const groundPosition: Vec3 = [12.345, 3.456, -7.891];
    for (const [index, { region, settlement, npc }] of NPC_SOURCES.entries()) {
      const preset = FEATURE_LAB_CATALOG.targets.npc.find((candidate) => candidate.id === npc.id);
      if (preset === undefined) throw new Error(`Missing NPC preset ${npc.id}`);
      const requestedAssets: string[] = [];
      const entity = createFeatureLabEntity(preset, {
        entityId: `lab-npc-${index}`,
        groundPosition,
        baseY: (assetId) => {
          requestedAssets.push(assetId);
          return -0.375;
        },
      });
      const questIds = npc.questIds.length > 0
        ? [...npc.questIds]
        : QUESTS.filter((quest) => quest.giverNpcId === npc.id).map((quest) => quest.id);

      expect(requestedAssets).toEqual([npc.assetId]);
      expect(entity).toEqual({
        id: `lab-npc-${index}`,
        archetype: "npc",
        name: npc.name,
        tier: region.tier,
        regionId: region.id,
        position: [groundPosition[0], round2(groundPosition[1] + 0.375), groundPosition[2]],
        state: "idle",
        interactions: ["inspect", "talk"],
        npc: {
          dialogueRootId: npc.dialogueRootId,
          questIds,
        },
        view: {
          assetId: npc.assetId,
          partAssetIds: npcOutfitParts(npc.id, npc.assetId),
          rotationY: npc.facingRad,
          labelHeight: 2.2,
        },
        meta: { settlementId: settlement.id },
      });
    }
  });

  it("reproduces the regionBuilder enemy and boss shape for every authored group", () => {
    const groundPosition: Vec3 = [12.345, 3.456, -7.891];
    const baseY = -0.375;
    for (const [index, source] of CREATURE_SOURCES.entries()) {
      const presetId = source.dungeonName === null
        ? source.group.id
        : `${source.regionId}:${source.group.id}`;
      const preset = FEATURE_LAB_CATALOG.targets.creature.find((candidate) => candidate.id === presetId);
      if (preset === undefined) throw new Error(`Missing creature preset ${presetId}`);
      const enemy = ENEMY_BY_ID.get(source.group.id)
        ?? ENEMY_BY_ID.get(enemyIdFor(source.group.family, source.group.tier));
      const viewScale = source.group.boss ? source.group.scale * 1.6 : source.group.scale;
      const drawnScale = viewScale * tierSilhouetteScale(source.group.tier);
      const position: Vec3 = [
        groundPosition[0],
        round2(groundPosition[1] - baseY * drawnScale),
        groundPosition[2],
      ];

      expect(createFeatureLabEntity(preset, {
        entityId: `lab-creature-${index}`,
        groundPosition,
        baseY,
      })).toEqual({
        id: `lab-creature-${index}`,
        archetype: source.group.boss ? "boss" : "enemy",
        name: source.group.name,
        tier: source.group.tier,
        regionId: source.regionId,
        position,
        state: "alive",
        interactions: ["inspect", "attack"],
        combat: {
          health: enemy?.maxHealth ?? source.group.maxHealth,
          maxHealth: enemy?.maxHealth ?? source.group.maxHealth,
          level: source.group.level,
          aggroRadius: enemy?.aggroRadius ?? source.group.aggroRadius,
        },
        view: {
          assetId: source.group.assetId,
          scale: viewScale,
          rotationY: 0,
          materialTier: source.group.tier,
          labelHeight: source.group.boss ? 3.4 : 2.2,
        },
        meta: {
          family: source.group.family,
          groupId: source.group.id,
          behaviour: source.group.behaviour,
          spawnX: round2(position[0]),
          spawnZ: round2(position[2]),
        },
      });
    }
  });

  it("honours caller ids and facing while returning fresh mutable semantic state", () => {
    const npcPreset = FEATURE_LAB_CATALOG.targets.npc[0];
    const creaturePreset = FEATURE_LAB_CATALOG.targets.creature[0];
    if (npcPreset === undefined || creaturePreset === undefined) throw new Error("Target catalogs are empty");
    const placement = { groundPosition: [0, 0, 0] as const, baseY: 0 };
    const npcA = createFeatureLabEntity(npcPreset, {
      ...placement,
      entityId: "caller-owned-npc-a",
      rotationY: Math.PI,
    });
    const npcB = createFeatureLabEntity(npcPreset, {
      ...placement,
      entityId: "caller-owned-npc-b",
    });
    const creatureA = createFeatureLabEntity(creaturePreset, {
      ...placement,
      entityId: "caller-owned-creature-a",
      rotationY: Math.PI,
    });
    const creatureB = createFeatureLabEntity(creaturePreset, {
      ...placement,
      entityId: "caller-owned-creature-b",
    });

    expect(npcA.id).toBe("caller-owned-npc-a");
    expect(npcA.view?.rotationY).toBe(Math.PI);
    expect(creatureA.view?.rotationY).toBe(3.14);
    expect(npcA).not.toBe(npcB);
    expect(npcA.interactions).not.toBe(npcB.interactions);
    expect(npcA.npc?.questIds).not.toBe(npcB.npc?.questIds);
    expect(npcA.view?.partAssetIds).not.toBe(npcB.view?.partAssetIds);
    expect(creatureA).not.toBe(creatureB);
    expect(creatureA.interactions).not.toBe(creatureB.interactions);
    expect(creatureA.combat).not.toBe(creatureB.combat);
    expect(creatureA.view).not.toBe(creatureB.view);
    expect(creatureA.meta).not.toBe(creatureB.meta);
  });

  it("rejects unknown presets and non-finite placement data", () => {
    const unknown: FeatureLabPreset = { id: "missing", label: "Missing", kind: "npc", tier: 1 };
    const npcPreset = FEATURE_LAB_CATALOG.targets.npc[0];
    if (npcPreset === undefined) throw new Error("NPC catalog is empty");

    expect(() => createFeatureLabEntity(unknown, {
      entityId: "unknown",
      groundPosition: [0, 0, 0],
      baseY: 0,
    })).toThrow(/Unknown feature-lab npc preset/);
    expect(() => createFeatureLabEntity(npcPreset, {
      entityId: "",
      groundPosition: [0, 0, 0],
      baseY: 0,
    })).toThrow(/entity id must be non-empty/);
    expect(() => createFeatureLabEntity(npcPreset, {
      entityId: "bad-position",
      groundPosition: [Number.NaN, 0, 0],
      baseY: 0,
    })).toThrow(/ground position must be finite/);
    expect(() => createFeatureLabEntity(npcPreset, {
      entityId: "bad-base",
      groundPosition: [0, 0, 0],
      baseY: () => Number.POSITIVE_INFINITY,
    })).toThrow(/base Y.*must be finite/);
  });
});

function titleCaseIdentifier(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replaceAll("_", " ");
  return words.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
