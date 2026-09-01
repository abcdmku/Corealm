/**
 * Which animal becomes which asset, and which source clip answers which motion.
 *
 * CLIP NAMING IS LOAD-BEARING. `render/entityViews.ts` picks an asset's own clips by regex: idle
 * matches /^idle/i, walk /^walk/i, attack /^bite/i or /attack/i, death /^death/i. So the names on
 * the right of each pair are a contract, not decoration. The pack spells death "Die", which matches
 * nothing, and every source file's single clip is called "Take 001", so both have to be renamed
 * here or a rig ships five colliding clips and no death.
 *
 * WALK AND RUN ARE BOTH SHIPPED, and each is the pack's own clip of that name.
 *
 * CORRECTION, and it is the root of a bug reported three times. This used to map the RUN clip to
 * "Walk" for every animal, on the reasoning that `systems/enemyAI.ts` only ever moved an enemy
 * while pursuing at 3.1 m/s, so the run cycle was the honest gait for the only speed that existed.
 * Both halves of that stopped being true: enemies now potter about while idle, and pursuit speeds
 * are solved from each animal's gait rather than fixed at 3.1.
 *
 * What it cost while it was true is worse. A gallop is a gallop at any playback rate, so every
 * creature in the game walked with a running gait, and the only lever left was to retime it — which
 * is why the roster ended up at three and four leg cycles a second and was reported as "their feet
 * move rapidly and they are jittery". No amount of speed tuning reaches that, because the POSES are
 * wrong, not the timing.
 *
 * The pack ships a real `_Walk` for every one of these. Measured on the chicken: the walk cycle is
 * 1.03 s implying 0.22 m/s, against the run's 0.57 s implying 0.75. Those are different animations,
 * and using the second where the first belongs is the whole defect.
 *
 * ATTACK SUBSTITUTES. Chicken, deer and rabbit ship no attack clip. Their eat clip is a head-down
 * lunge, which is a peck, a butt and a nibble respectively, and that is the correct read for those
 * animals anyway, so it is mapped to Attack and played once rather than looped. The frog has no eat
 * clip either, so its hop stands in. Every substitute is recorded in `substitutes` so the build log
 * says out loud where authored art ran out.
 *
 * A substitute also needs TRIMMING, which is the optional third element on a clip entry: an
 * explicit [firstFrame, lastFrame] window at 30 fps. A feeding cycle is authored as a long loop,
 * and playing all of it as an attack is what produced the reported "chickens do not stop eating
 * while attacking" - the chicken's eat clip is 230 frames, so every peck was 7.7 seconds of
 * grazing. The windows below keep only the opening head-down strike, which is the part that reads
 * as an attack, and leave the rest on the floor.
 *
 * Without a window a clip uses the full range Unity recorded for it in its .meta sidecar. That is
 * not the same as the whole file: the `_exp` rigs pack every motion into ONE take, so the range is
 * what separates the frog's hop from its death. See tools/animals/stage-clip-ranges.py.
 *
 * NAMED TAKES are the other way a file can hold several motions, and the converter supports them
 * even though no animal needs one. Every file in THIS pack holds a single take (always "Take 001"),
 * so the tuple entries below say nothing about takes and the converter reads `animations[0]`. A
 * pack that ships eleven named AnimStacks in one FBX - the miniboss rig does - instead passes
 * `take` on its clip entries (see tools/minibosses/catalog.mjs, which uses the object form
 * `{ take, name }`). A named take that is not in the file fails that clip's build outright; there
 * is deliberately no fall-back to `animations[0]`, because the wrong take still plays SOMETHING
 * and the defect ships silently.
 */
export const ANIMALS = [
  // ---------------------------------------------------------------- plains, Fallowmarch
  {
    id: "animal_chicken", rig: "Chicken_Rig.fbx", texture: "chicken_col14_unity.png",
    is: "chicken", tags: ["chicken", "hen", "fowl", "bird", "farm", "plains", "animal", "passive"],
    clips: [["Chicken_Idle", "Idle"], ["Chicken_Walk", "Walk"], ["Chicken_Run", "Run"], ["Chicken_Eat", "Attack", [1, 40]], ["Chicken_Die", "Death"]],
    substitutes: { attack: "synthesised peck lunge" },
    synthAttack: { reach: 0.12, dip: 4, ms: 520 },
  },
  {
    id: "animal_chicken_speckled", rig: "Chicken_Rig.fbx", texture: "chicken_col_v3_unity.png",
    is: "chicken", tags: ["chicken", "hen", "fowl", "bird", "farm", "plains", "animal", "variant"],
    clips: [["Chicken_Idle", "Idle"], ["Chicken_Walk", "Walk"], ["Chicken_Run", "Run"], ["Chicken_Eat", "Attack", [1, 40]], ["Chicken_Die", "Death"]],
    substitutes: { attack: "synthesised peck lunge" },
    synthAttack: { reach: 0.12, dip: 4, ms: 520 },
  },
  {
    id: "animal_cattle", rig: "Cattle_Rig.fbx", texture: "iron_age_cattle_col_unity.png",
    is: "cow", tags: ["cow", "cattle", "ox", "bovine", "farm", "plains", "animal", "territorial"],
    clips: [["Cattle_Idle", "Idle"], ["Cattle_Walk", "Walk"], ["Cattle_Run", "Run"], ["Cattle_Attack", "Attack"], ["Cattle_Die", "Death"]],
  },
  {
    id: "animal_aurochs", rig: "Cattle_Rig.fbx", texture: "iron_age_cattle_v2_col3_unity.png",
    is: "aurochs", tags: ["aurochs", "cattle", "bull", "bovine", "highland", "animal", "variant"],
    clips: [["Cattle_Idle", "Idle"], ["Cattle_Walk", "Walk"], ["Cattle_Run", "Run"], ["Cattle_Attack", "Attack"], ["Cattle_Die", "Death"]],
  },
  {
    id: "animal_goat", rig: "Goat_Rig.fbx", texture: "goat_col_v5_unity.png",
    is: "goat", tags: ["goat", "billy", "horned", "farm", "plains", "animal", "aggressive"],
    clips: [["Goat_Idle", "Idle"], ["Goat_Walk", "Walk"], ["Goat_Run", "Run"], ["Goat_Attack", "Attack"], ["Goat_Die", "Death"]],
  },
  {
    id: "animal_rabbit", rig: "WildRabbit_Rig.fbx", texture: "wild_rabbit_col5_unity.png",
    is: "rabbit", tags: ["rabbit", "bunny", "hare", "coney", "plains", "forest", "animal", "passive"],
    clips: [["WildRabbit_Idle", "Idle"], ["WildRabbit_Walk", "Walk"], ["WildRabbit_Run", "Run"], ["WildRabbit_Eat", "Attack", [1, 26]], ["WildRabbit_Die", "Death"]],
    substitutes: { attack: "synthesised nip lunge" },
    synthAttack: { reach: 0.11, dip: 3, ms: 520 },
  },
  {
    id: "animal_rabbit_dark", rig: "WildRabbit_Rig.fbx", texture: "wild_rabbit_col_v3_unity.png",
    is: "rabbit", tags: ["rabbit", "bunny", "hare", "coney", "forest", "animal", "variant"],
    clips: [["WildRabbit_Idle", "Idle"], ["WildRabbit_Walk", "Walk"], ["WildRabbit_Run", "Run"], ["WildRabbit_Eat", "Attack", [1, 26]], ["WildRabbit_Die", "Death"]],
    substitutes: { attack: "synthesised nip lunge" },
    synthAttack: { reach: 0.11, dip: 3, ms: 520 },
  },
  {
    id: "animal_frog", rig: "common_frog_rig_exp.FBX", texture: "common_frog_col_unity.png",
    is: "frog", tags: ["frog", "toad", "amphibian", "water", "marsh", "pond", "animal", "passive"],
    clips: [["common_frog_idle_anim", "Idle"], ["common_frog_walk_anim", "Walk"], ["common_frog_run_anim", "Run"], ["common_frog_run_anim", "Attack"], ["common_frog_die_anim", "Death"]],
    substitutes: { attack: "synthesised snap lunge" },
    synthAttack: { reach: 0.14, dip: 4, ms: 460 },
  },
  {
    id: "animal_frog_green", rig: "common_frog_rig_exp.FBX", texture: "common_frog_col_v2_unity.png",
    is: "frog", tags: ["frog", "toad", "amphibian", "water", "marsh", "pool", "animal", "variant"],
    clips: [["common_frog_idle_anim", "Idle"], ["common_frog_walk_anim", "Walk"], ["common_frog_run_anim", "Run"], ["common_frog_run_anim", "Attack"], ["common_frog_die_anim", "Death"]],
    substitutes: { attack: "synthesised snap lunge" },
    synthAttack: { reach: 0.14, dip: 4, ms: 460 },
  },

  // ---------------------------------------------------------------- forest, Vellenwood
  {
    id: "animal_deer", rig: "Deer_Rig.fbx", texture: "deer_col6_unity.png",
    is: "deer", tags: ["deer", "stag", "hart", "doe", "antler", "forest", "animal", "territorial"],
    clips: [["Deer_Idle", "Idle"], ["Deer_Walk", "Walk"], ["Deer_Run", "Run"], ["Deer_Eat", "Attack", [1, 34]], ["Deer_Die", "Death"]],
    substitutes: { attack: "synthesised head butt" },
    synthAttack: { reach: 0.10, dip: 3, ms: 620 },
  },
  {
    id: "animal_coyote", rig: "Wolf_Rig.fbx", texture: "common_wolf_col2_unity.png",
    is: "coyote", tags: ["coyote", "wolf", "canine", "pack", "forest", "animal", "aggressive"],
    clips: [["Wolf_IdleA", "Idle"], ["Wolf_Walk", "Walk"], ["Wolf_Run", "Run"], ["Wolf_Attack", "Attack"], ["Wolf_Die", "Death"]],
    // Wolf_Attack is authored entirely in the head and jaw: rendered across six phases the body
    // does not move at all, so at any real distance the coyote appears to do nothing. The bite is
    // kept and a body lunge is layered onto it.
    synthAttack: { base: "Attack", reach: 0.08, dip: 2, ms: 900 },
  },
  {
    id: "animal_hog", rig: "iron_age_pig_rig_exp.FBX", texture: "iron_age_pig_col_unity.png",
    is: "hog", tags: ["hog", "pig", "swine", "forest", "bramble", "animal", "aggressive"],
    clips: [["iron_age_pig_idle_anim", "Idle"], ["iron_age_pig_walk_anim", "Walk"], ["iron_age_pig_eat_anim", "Attack", [150, 186]], ["iron_age_pig_die_anim", "Death"]],
    substitutes: { walk: "iron_age_pig_walk (pack ships no run cycle)", attack: "synthesised tusk jab" },
    synthAttack: { reach: 0.09, dip: 3, ms: 580 },
  },
  {
    id: "animal_viper", rig: "Viper_Rig.fbx", texture: "asp_viper_col6_unity.png",
    is: "viper", tags: ["viper", "adder", "snake", "serpent", "venom", "forest", "animal", "territorial"],
    clips: [["Viper_Idle", "Idle"], ["Viper_Glide", "Walk"], ["Viper_FastGlide", "Run"], ["Viper_Attack", "Attack"], ["Viper_Die", "Death"]],
  },

  // ---------------------------------------------------------------- rocky, Karrowmoor
  {
    id: "animal_bear", rig: "Bear_Rig.fbx", texture: "brown_bear_col_v2_unity.png",
    is: "bear", tags: ["bear", "bruin", "predator", "rocky", "cave", "animal", "aggressive"],
    clips: [["Bear_Idle", "Idle"], ["Bear_Walk", "Walk"], ["Bear_Run", "Run"], ["Bear_Attack", "Attack"], ["Bear_Die", "Death"]],
  },
  {
    id: "animal_boar", rig: "WildBoar_Rig.fbx", texture: "wild_boar_col9_unity.png",
    is: "boar", tags: ["boar", "tusk", "swine", "rocky", "scree", "animal", "aggressive"],
    clips: [["WildBoar_Idle", "Idle"], ["WildBoar_Walk", "Walk"], ["WildBoar_Run", "Run"], ["WildBoar_Attack", "Attack"], ["WildBoar_Die", "Death"]],
  },
  {
    id: "animal_ibex", rig: "Ibex_Rig.fbx", texture: "ibex_col16_unity.png",
    is: "ibex", tags: ["ibex", "goat", "horned", "ridge", "rocky", "animal", "territorial"],
    clips: [["Ibex_Idle", "Idle"], ["Ibex_Walk", "Walk"], ["Ibex_Run", "Run"], ["Ibex_Attack", "Attack"], ["Ibex_Die", "Death"]],
  },

  // ---------------------------------------------------------------- dungeon, Gravelmaw
  {
    id: "animal_rat", rig: "rat_rig_exp.FBX", texture: "rat_col13_unity.png",
    is: "rat", tags: ["rat", "rodent", "vermin", "cave", "dungeon", "animal", "aggressive"],
    clips: [["rat_idle_anim", "Idle"], ["rat_walk_anim", "Walk"], ["rat_walk_anim", "Attack", [10, 30]], ["rat_die_anim", "Death"]],
    substitutes: { walk: "rat_walk (pack ships no run cycle)", attack: "synthesised bite lunge" },
    synthAttack: { reach: 0.13, dip: 3, ms: 460 },
  },
  {
    id: "animal_scorpion", rig: "Scorpion_Rig.fbx", texture: "scorpion_col15_unity.png",
    is: "scorpion", tags: ["scorpion", "sting", "arachnid", "cave", "dungeon", "animal", "aggressive"],
    clips: [["Scorpion_Idle", "Idle"], ["Scorpion_Walk", "Walk"], ["Scorpion_Run", "Run"], ["Scorpion_Attack", "Attack"], ["Scorpion_Die", "Death"]],
  },
  {
    id: "animal_crab", rig: "crab_rig.FBX", texture: "crab_col12_unity.png",
    is: "crab", tags: ["crab", "shell", "claw", "sump", "cave", "water", "animal", "territorial"],
    clips: [["crab_walk_anim", "Idle"], ["crab_walk_anim", "Walk"], ["crab_run_anim", "Run"], ["crab_run_anim", "Attack"], ["crab_die_anim", "Death"]],
    // Unity records Crab_idle as frames 110-111, a single held pose, and a one-frame clip is
    // degenerate enough that optimization drops it outright - the crab shipped with no Idle at
    // all and fell back to scuttling in place. Widened to eight frames so it survives.
    substitutes: { idle: "crab_walk (the pack ships a single-frame idle, which optimizes to a 0 s clip)", walk: "crab_walk (crab_run does not close its cycle and popped 52 degrees per loop)", attack: "synthesised claw rush" },
    synthAttack: { reach: 0.14, dip: 2, ms: 500 },
  },

  // ---------------------------------------------------------------- water, fishing shoals
  // Fish are shoal dressing for fishing spots, never combatants. The pack ships them with swim
  // cycles only, no idle and no death, so there is nothing to fake and nothing to fight.
  {
    id: "animal_perch", rig: "perch_fish_rig_exp.FBX", texture: "perch_fish_col_unity.png",
    is: "fish", tags: ["fish", "perch", "shoal", "school", "water", "fishing", "animal"],
    clips: [["perch_fish_swim_anim", "Idle"], ["perch_fish_fastswim_anim", "Walk"]],
    substitutes: { idle: "perch_swim (a fish never stops swimming)" },
  },
  {
    id: "animal_pike", rig: "pike_rig_exp.FBX", texture: "pike_col_unity.png",
    is: "fish", tags: ["fish", "pike", "shoal", "school", "water", "fishing", "animal"],
    clips: [["pike_swim_anim", "Idle"], ["pike_fastswim_anim", "Walk"]],
    substitutes: { idle: "pike_swim (a fish never stops swimming)" },
  },
  {
    id: "animal_salmon", rig: "salmon_rig_exp.FBX", texture: "salmon_col13_unity.png",
    is: "fish", tags: ["fish", "salmon", "shoal", "school", "water", "fishing", "animal"],
    clips: [["salmon_swim_anim", "Idle"], ["salmon_fastswim_anim", "Walk"]],
    substitutes: { idle: "salmon_swim (a fish never stops swimming)" },
  },
];
