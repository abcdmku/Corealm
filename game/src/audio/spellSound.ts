import type { SpellElement, SpellRung } from "../contracts.js";

/**
 * Four elemental voices out of six .ogg files, by per-play gain and pitch only.
 *
 * There is no wind recording and no water recording. The entire magic library on disk is six files
 * — `magic-ember-cast-01/02`, `magic-stone-cast-01/02`, `magic-impact-01/02`, all 44.1 kHz stereo
 * Vorbis, 23–82 kB — behind exactly two cue ids, `combat.magic_cast` and `combat.magic_hit`. So the
 * elements are separated the way the VFX atlas separates them: one asset set, four identities, from
 * tint there and from pitch and level here. Adding cue ids would only point new names at the same
 * two ember/stone casts, which is what makes all sixteen spells sound identical today.
 *
 * These are pure lookups on purpose — no RNG, no clock, no state. Spec section 8 forbids RNG stream
 * draws in the audio layer because an acceptance check that replays a cast must get the same
 * numbers twice. Variant rotation inside the engine already supplies the "not a machine gun"
 * variation, deterministically (`AudioEngine.nextVariant`).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT EACH ELEMENT IS TRYING TO SOUND LIKE, AND WHICH NUMBER CARRIES IT
 *
 * Tuning knob per element is `ELEMENT_RATE` first. `ELEMENT_GAIN` is a small loudness correction,
 * NOT an identity knob — move it only if an element reads too loud or too soft against the others
 * at the same rung, never to make an element "bigger".
 *
 *   wind  1.22  fast, high, airy. Pitching the ember cast up a major third — 12*log2(1.22) = +3.4
 *               semitones — strips its body and leaves the hiss, which is the closest thing to
 *               moving air these six files contain. It is also the quietest element (gain 0.95)
 *               because bright material already sounds louder at equal level.
 *   water 1.06  mid, rounded. Barely off the recording, and that is the point: water is the
 *               reference the other three are heard against. Gain 1.00, i.e. untouched.
 *   fire  0.96  full-bodied roar. Slightly BELOW the source so the ember cast keeps its low end;
 *               the recordings are already fire, so fire is the element that needs the least done
 *               to it. Gain 1.04 for a little extra chest.
 *   earth 0.78  slow, low, heavy. The biggest move in the table — 12*log2(0.78) = -4.3 semitones,
 *               a major third down — which stretches the clip and makes earth read as the slow
 *               element without touching timing, which this layer cannot touch anyway. Pitching
 *               down throws away high-frequency energy, so earth needs the largest gain trim
 *               (1.10) just to sit level with the others.
 *
 * Rung does two things at once, in `RUNG_RATE` and `RUNG_GAIN`: pitch DOWN and level UP as the
 * spell gets bigger. A surge has to sound like the expensive thing it is, and the two moves
 * reinforce each other — bigger sources are lower and louder in the real world, so doing only one
 * reads as a volume slider rather than as a heavier spell.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RESULTING TABLE, and why nothing in it clips or chipmunks
 *
 * `AudioEngine.playCue` treats `options.gain` as a MULTIPLIER on the catalog gain and then runs the
 * product through `clamp01` (engine.ts, the `voiceGain.gain.value` assignment). `options.playbackRate`
 * REPLACES the catalog's range midpoint outright rather than multiplying it (engine.ts
 * `playbackRate()`: `if (override !== undefined) return positiveFinite(override, 1)`). Both
 * behaviours are load-bearing here: the gain numbers below are ratios, and the rate numbers are
 * absolute.
 *
 * Catalog gains are `combat.magic_cast` 0.5 and `combat.magic_hit` 0.58, so the loudest voice this
 * table can produce is an earth surge landing at 0.58 * 1.452 = 0.84. That is deliberately short of
 * `clamp01`'s ceiling: if any row clamped, every row above it would flatten to the same level and
 * the rung ladder would stop being audible at exactly the rungs it matters most for.
 *
 *   element/rung   cast rate  hit rate  miss rate   bus gain: cast / hit / miss
 *   wind  lash        1.293     1.267     1.166        0.380  0.441  0.212
 *   wind  surge       1.074     1.052     0.968        0.627  0.727  0.349
 *   water surge       0.933     0.914     0.841        0.660  0.766  0.368
 *   fire  lash        1.018     0.997     0.917        0.416  0.483  0.232
 *   fire  surge       0.845     0.828     0.762        0.687  0.796  0.382
 *   earth lash        0.827     0.810     0.745        0.440  0.510  0.245
 *   earth surge       0.686     0.673     0.619        0.726  0.842  0.404
 *
 * The miss column is the one worth checking twice, and the first draft of this table got it wrong:
 * a miss plays `combat.magic_hit`, whose catalog gain is 0.58, NOT `combat.magic_cast`'s 0.5, so
 * every miss figure was quoted 16% low. Corrected above.
 *
 * Full spread across all sixteen spells and all three shapes: rate 0.619 to 1.293, bus gain 0.212
 * to 0.842. Both sit inside their limits with room, so a later tuning pass can move a number
 * without silently hitting a clamp.
 */

/**
 * Sane playback-rate band: **0.6 to 1.45**, and the table above is built to stay inside it.
 *
 * These are 44.1 kHz one-shots with no time-stretching — Web Audio's `playbackRate` resamples, so
 * pitch and duration move together. Above ~1.45 an ember cast turns into a chipmunk: the body
 * disappears, the clip gets short enough to read as a click, and it stops sounding like a spell at
 * all. Below ~0.6 the same clip smears into mud — the transient softens past the point where you
 * can tell a cast started, and the stretched tail collides with the next cast at the 3000 ms cast
 * time. Neither edge reads as magic. If you need something outside this band you need a different
 * recording, not a bigger number.
 */
const RATE_MIN = 0.6;
const RATE_MAX = 1.45;

/** Pitch centre per element. This is the identity knob; see the block comment above. */
const ELEMENT_RATE: Readonly<Record<SpellElement, number>> = {
  wind: 1.22,
  water: 1.06,
  earth: 0.78,
  fire: 0.96,
};

/**
 * Loudness correction per element, compensating for what the pitch move did to the spectrum.
 * Pitching earth down a major third moves its energy into a band the ear is less sensitive to,
 * so it needs +10% just to sit level; wind gains brightness for free and gets -5% back.
 */
const ELEMENT_GAIN: Readonly<Record<SpellElement, number>> = {
  wind: 0.95,
  water: 1.0,
  earth: 1.1,
  fire: 1.04,
};

/** Rung pitches DOWN as the spell gets bigger. Multiplicative because pitch is logarithmic. */
const RUNG_RATE: Readonly<Record<SpellRung, number>> = {
  lash: 1.06,
  bolt: 1.0,
  burst: 0.94,
  surge: 0.88,
};

/** Rung pushes level UP as the spell gets bigger. A lash is cheap and must sound cheap. */
const RUNG_GAIN: Readonly<Record<SpellRung, number>> = {
  lash: 0.8,
  bolt: 0.94,
  burst: 1.12,
  surge: 1.32,
};

/**
 * The landing sits a touch below its own cast so the pair reads as one spell arriving rather than
 * as a second cast. Only 2% — enough to hear as weight, not enough to break the element identity
 * that the cast just established a few hundred milliseconds earlier.
 *
 * The impact is not given a gain boost here because the catalog already supplies one: `magic_hit`
 * is 0.58 against `magic_cast`'s 0.5. Adding a second one would have pushed earth surge into
 * `clamp01`.
 */
const IMPACT_RATE_TILT = 0.98;

/**
 * A miss is quieter, lower and duller than a hit — the audible half of the information the VFX
 * layer carries when a bolt fizzles short. Today a missed cast is completely silent, which reads as
 * a dropped input rather than as a failed roll.
 *
 * The 0.48 gain ratio is copied from what melee already ships: `combat.melee_miss` 0.30 against
 * `combat.melee_hit` 0.62. Players have that ratio calibrated from every sword swing they have
 * taken, so a fizzle lands at the same relative level as a whiff.
 *
 * Pitch goes the OPPOSITE way from melee's, and that is intentional. `combat.melee_miss` plays
 * FASTER than `combat.melee_hit` ([1.08, 1.16] against [0.95, 1.04]) because a whiff is air moving
 * past a blade that met nothing. A fizzling spell is the opposite event: energy that failed to
 * arrive, which reads as sagging, not as speeding up. Dropping the rate also rolls off the top end,
 * which is where "dull" comes from — gain and pitch are the only two knobs this layer has, so the
 * dullness has to be bought with the pitch one.
 */
const MISS_RATE = 0.92;
const MISS_GAIN = 0.48;

/** Per-play overrides handed straight to `AudioEngine.playCue`; `gain` is a multiplier, not a level. */
export interface SpellSoundShape {
  gain: number;
  playbackRate: number;
}

/** The voice of the cast itself, played on the rig's measured swing marker. */
export function spellCastSound(element: SpellElement, rung: SpellRung): SpellSoundShape {
  return shape(ELEMENT_GAIN[element] * RUNG_GAIN[rung], ELEMENT_RATE[element] * RUNG_RATE[rung]);
}

/**
 * The voice of the landing, played on the contact marker. `hit` false is a fizzle, not silence.
 */
export function spellImpactSound(element: SpellElement, rung: SpellRung, hit: boolean): SpellSoundShape {
  const gain = ELEMENT_GAIN[element] * RUNG_GAIN[rung] * (hit ? 1 : MISS_GAIN);
  const rate = ELEMENT_RATE[element] * RUNG_RATE[rung] * IMPACT_RATE_TILT * (hit ? 1 : MISS_RATE);
  return shape(gain, rate);
}

/**
 * Rounds to 1e-3 and clamps the rate into the band.
 *
 * The rounding is not cosmetic: these values end up in audio diagnostics and in any future snapshot
 * test, and `0.78 * 0.88 * 0.98` printing as `0.6726719999999999` would make a regression diff
 * unreadable for no gain — a thousandth of a semitone is far below audibility.
 */
function shape(gain: number, playbackRate: number): SpellSoundShape {
  return {
    gain: round3(gain),
    playbackRate: round3(Math.max(RATE_MIN, Math.min(RATE_MAX, playbackRate))),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
