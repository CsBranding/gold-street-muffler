# BLOCK WARS (working title)

Portrait 3D lane-runner / crowd-battle game. Pick a lane, run through number
gates to grow your crew, shoot numbered obstacles for loot, hold the block
against hordes, push up, and take down the boss.

TypeScript · Vite · Three.js · Zod. Capacitor wraps it for iOS/Android in Phase 4.

```bash
npm install
npm run dev         # http://localhost:5173
npm test            # sim + config tests (vitest)
npm run build       # typecheck + production build to dist/
npm run validate    # validate all config JSON
npm run schemas     # regenerate /schemas/*.schema.json from the Zod schemas
npx tsx scripts/balance.ts [mode] [seed]   # pacing report per level (autoplay bot)
```

Dev URL params: `?level=N` jump into a level · `&auto` bot plays · `&skip=S`
fast-forward S seconds · `&seed=N` · `?stress` 500 crew vs 1,500 enemies ·
`&fps` frame cost overlay (sim / scene update / GL submit) · `&q=0..3` quality tier.

## Architecture

```
src/
  config/      *.json — every tunable number, name, slogan and color (frozen schema)
  schema/      schemas.ts (Zod, source of truth) · types.ts · loadConfig.ts (parse + cross-refs)
  sim/         pure TS, no Three.js/DOM — fixed-timestep battle simulation
    battle.ts    crowd, gates, obstacles, hordes, boss, rewards, events
    level.ts     compiles levels.json + battle mode + difficulty into runtime entities
    formation.ts phyllotaxis crowd layout (shared with the renderer)
    loadout.ts   perks + upgrades → battle modifiers
    bot.ts       autoplay (tests, attract mode)
  render/      Three.js — instanced crowds, LOD, pooled effects, props, boss, camera
  ui/          DOM overlay (projected counts, damage numbers, banners), HUD, styles
  game/        app.ts (screen flow), session.ts (loop + input), results.ts
  services/    save (versioned doc, pluggable backend), ads (AdService + mock), haptics
schemas/       generated JSON Schema for each config file
tests/         vitest suites
```

- **Sim / render split.** `Battle.step()` runs at `game.sim.tickHz` (30 Hz) and
  owns all gameplay state. The renderer only reads state and consumes drained
  `SimEvent`s; it interpolates and smooths positions, so sim rate and frame
  rate are independent. Battles are deterministic for a seed + inputs.
- **Config-driven.** Gameplay code reads numbers from `src/config`. Faction
  names, weapon names, slogans and banner text all live there so they can be
  renamed for store review without code changes. Bad references fail at boot
  with a list of every problem.
- **Crowds at scale.** Crew and enemies are struct-of-arrays in the sim and
  `InstancedMesh`es in the renderer (one draw per outfit per LOD level). The
  run cycle is in the vertex shader (per-instance phase from `gl_InstanceID`),
  so animation costs no CPU. Units past `render.lodDistance` use a ~190-vertex
  LOD mesh. Tracers, particles, damage numbers and labels come from fixed pools.
- **Squad fire** is aggregated: shots per tick = crew × rate × sustain (mag vs
  reload), capped at `sim.maxShotsPerTick` with damage scaled to match, so
  500 crew cost the same as 50. The leader fires discrete shots with a real mag.
- **3D animation.** Characters are procedural rigged humanoids (`render/rig.ts`):
  rounded low-poly parts skinned to a 15-bone skeleton, with keyframed clips
  (run, aim, shoot recoil, knockdown fall, cheer; boss idle, slam windup/smash,
  shield raise, roar, topple). The leader and bosses are `SkinnedMesh`es driven
  by an `AnimationMixer` with crossfades. Crowds bake those same clips into
  vertex animation textures (`render/vat.ts`), so every instance plays a
  real skeletal animation from the GPU with its own clip and phase.
- **Look.** Toon shading with rim light, ACES tone mapping, soft directional
  shadows for leader/boss/props, instanced blob shadows for crowds, bloom on
  muzzle flashes and light bars, sky dome with a hazy sun, and suspension-bridge
  towers, cables and skyline on Freeway Bridge.
- **LOD + adaptive quality.** 3 crowd LODs (≈2,150 / 590 / 420 verts) with a
  per-frame cap on full-detail units. Quality tiers step down automatically
  when frames run long (bloom → shadows → resolution → LOD range), the chosen
  tier is saved per device, and `?q=0..3` forces one.
- **Art swap.** `config/assets.json` maps logical ids to a model URL or a
  procedural placeholder. Phase 1 uses placeholders only.

## Content notes

Rated 17+ for stylized violence. No blood or gore: downed units poof into
smoke. All faction/weapon names are config strings.

---

## Phase report

### Phase 0: frozen schema ✅
Zod schemas + inferred TS types for factions, characters, weapons, enemies,
bosses, levels, economy, game tunables and the asset manifest. The weapons
table matches the spec. Cross-reference validation covers weapon, enemy, boss
and leader ids, 4 leaders per faction, and boss-level flags. JSON Schemas are
generated into `/schemas`.

### Phase 1: vertical slice ✅
- **Freeway Bridge**: levels 1–3 plus the boss level (level 10), unlocked in sequence. Red faction vs Cops.
- **Lanes**: lanes behind low walls, each with an HP barricade. Contents are visible ahead, so the choice is informed and locks once you're through.
- **Gates**: +N / ×N (faction color) and −N / ÷N (dark grey). The math applies instantly, recruits pop into a phyllotaxis formation, and the count floats above the crowd.
- **Obstacles**: barrels, crates, dumpsters, cruisers and barricades with HP. Rewards glow by rarity: weapon, weapon level, recruits, leader shard, lowrider, dirt bike, drum mag, armor vest.
- **Weapons**: 9mm, Full-Auto Pistol and Draco, with spread, mag/reload, muzzle climb and pierce.
- **Enemies**: Patrol Officers and Riot Cops. Riot shields block frontal fire until flanked or broken. Hordes have counts and health bars, a hold-then-push flow, contact melee and mid-fight pickups.
- **Big Sarge**: every attack is telegraphed (0.8–1.2 s, red ground marker): Baton Slam, Shield Wall (flank to damage), Taser Chain, Call for Backup (officers + exploding cruisers), Tear Gas, and Enrage below 30%. Headshots while unshielded deal 2×. On defeat: slow-mo, camera push-in, topple, loot burst.
- **Screens and services**: Splash (with an attract-mode demo), level hub, HUD (portrait + Cash/Rep/Ice), pause, fail → revive via a rewarded ad, results with stars and 2× loot via ad, interstitial rules, local save.

**Pacing.** The bot clears L1–L3 in about 53–61 s and the boss level in 77–97 s. Humans play slower than the bot. Tests assert every level is won in under 120 s across seeds.

### Self-critique pass: top 5 found and fixed
1. **Perf:** 2,000 full-detail units ≈ 1.4 M vertices per frame, which is risky on mid-range GPUs. Added distance LOD meshes (624 → 192 verts). Software-GL submit time in the stress scene dropped from ~16–28 ms to ~10 ms.
2. **Readability:** hundreds of damage numbers stacked into unreadable smears. They are now summed per 1.5 m cell, flushed every 0.22 s and capped per flush, with crits shown first.
3. **Feel:** 1-px tracers were invisible on phone screens. They are now additive ribbons with a bright head, and muzzle flashes are bigger.
4. **Bugs:** the boss rendered upside-down under the road (an Euler reorder after a yaw quaternion). Pointer capture on the stage swallowed taps on the Pause button. Obstacles destroyed before a renderer load stayed visible.
5. **Readability:** crowd units clipped through barrels, and the leader's HP was invisible once the crew was gone. Units are now nudged out of obstacle footprints, and a leader HP bar appears under the crew count.

**Measured (headless Chromium, software GL):** at 500 crew vs 1,500 enemies, the sim takes ~1.1 ms per frame and the scene update ~1.4 ms. GPU cost has to be confirmed on a real mid-range Android device (`?stress&fps`), and that is the first item for Phase 2.

### Visual upgrade: rigged 3D characters + animation ✅
Replaced the box characters and shader leg-swing with skinned, keyframe-animated
characters (above). Downed units now play a knockdown and sink away (no gore),
the crew switches between run / shooting stance / cheer with the battle phase,
and Big Sarge winds up, slams, raises his shield, roars on enrage and topples.

### Next: Phase 2
Faction / Character / Battle Mode / Map select screens, the Blue faction, VS Rival
(mini-boss Big Homie at L5 and Big Sarge at L10) and All-Out three-way infighting,
the remaining weapons (Drum Draco, Micro SMG, AR Pistol, Pump, LMG, Gold Draco),
SWAT, Motor Cop, Helicopter spotlight, rival Enforcer/Runner/Rooftop/Drive-By,
hordes entering from the next lane, Hood Block and Harbor Pier maps, plus an
on-device performance pass.
