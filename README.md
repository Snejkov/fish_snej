# SnejFishing v0.0.05a-guests1 Stage 5A

Stage 5A is a browser-only Three.js lakeside sandbox with local rod casting, per-profile inventory, gear purchases, equipment slots, and profile statistics. It preserves the animated 24-bone angler, hand-attached carry props, profile launcher, waterbody selection, validated Snej Lake, safe spawns, static opaque water, corrected movement, one-meter wading, first-person and third-person cameras, developer Build Mode, synthesized audio, and optional raw WebSocket multiplayer scaffold. There are no fish, bites, fights, catch rewards, or lure swimming in this stage.

## Run

Start any static file server in this folder. For example:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/`. The game needs no Node runtime, package install, build step, CDN, webfont, native module, or downloaded media asset. Three.js is stored locally in `vendor/`.

## Language

Russian is the default. Select Russian or English during registration or later in Settings; language changes update the visible UI immediately. The shared `src/i18n.js` dictionary covers menus, HUD, accessible labels, gear names and descriptions, inventory, sets, profile, building tools, validation and casting messages. Source remains ASCII through Unicode escapes. The language is saved in the existing `settings.lang` field without changing inventory, positions or custom set names. Missing or unsupported languages fall back to Russian. Selecting a language before registration saves only that preference and does not create a profile. Localization tests cover defaults, migration, both languages, custom names and save integrity.

## Controls

- `W/A/S/D`: move and strafe.
- `Shift`: sprint.
- Settings: `Run without holding Shift` enables automatic sprint while moving; it defaults to off and is saved with the profile.
- Mouse: look after clicking the canvas.
- Hold left mouse: charge a cast; release to throw. A new hold after water landing clears the previous bobber and starts another cast.
- `V`: switch between first-person and third-person view.
- `B`: open or close Build Mode in third-person view when the derived rank is developer.
- `P`: open or close the profile drawer.
- `I`: open or close inventory. The pause menu also has an Inventory button.
- `Esc`: close the active drawer or open and close the pause menu.
- `U`: toggle the HUD.

The third-person camera distance is always `4.6`. The mouse wheel is not captured by the game and works normally in scrollable UI.

Touch/coarse-pointer devices automatically show a circular left movement joystick, a hold/release cast button, and menu, inventory, camera, players and fullscreen controls. Joystick displacement retains analog walking strength. An ordinary swipe on the canvas turns the camera independently of the movement finger. Opening menus, cancellation, lost capture, blur and resize reset held touch input. Keyboard and mouse remain available on hybrid devices. Touch-action is restricted to the game canvas and touch controls; drawers remain scrollable.

Landscape is requested from an entry/fullscreen user gesture when fullscreen and orientation-lock APIs are available. Unsupported or denied locks show a portrait rotate-device notice; the game does not force CSS rotation. Automated tests simulate independent pointer roles and actual game movement/camera integration, but do not substitute for physical-device multi-touch and orientation testing.

The development build always uses bright noon (12:00) for both the scene and game clock, regardless of device/server dates, pause, or tab inactivity. `DEFAULT_WORLD_CLOCK_MODE` in `src/game/clock.js` is `"development-day"`; this mode performs no server-time requests. Moscow mode is retained for later activation at the owner's request, through this default or `worldClock.setMode("moscow")`, but is not enabled by normal gameplay or saved settings. Movement, casting, clouds, water effects, and playtime keep their existing frame timing and pause behavior.

The inactive Moscow mode follows `Europe/Moscow` one-to-one (24 real hours per cycle) and requests the existing same-origin server's HTTP `Date` with a cache-busted HEAD request and `cache: "no-store"`. Cached or invalid replies are rejected; accepted samples advance with monotonic time and refresh every five minutes and on world creation/tab return. Before the first successful sample it falls back to device time; after a failed refresh an existing server sample keeps advancing. HTTP Date has one-second precision plus network delay and depends on the server clock, not a dedicated game-time protocol. Moscow mode preserves the existing smooth dawn/dusk and 06:00-18:00 visual daylight rules, without astronomical calculations. Neither mode saves or resets a calendar clock to 06:00.

Ambient wind and water loops default to 0%; event sounds such as buttons, casting, footsteps, and splashes retain the existing Volume setting. Loading an older save without `settings.ambientDefaultsVersion` resets only Ambient (`bgm`) once and records version 1. Progress and other settings are retained. Subsequent explicit Ambient changes are saved and restored without another reset. The ambient gain starts at the selected value immediately, avoiding a brief sound from the audio node's default gain.

Movement follows the rendered camera at every yaw: `A` always moves toward screen-left, `D` always moves toward screen-right, and diagonal input is normalized. Releasing movement keys eases the character animation back to idle. A released cast locks walking, strafing, and sprinting during flight, water wait, and automatic recovery. Look and view switching remain available. Clearing the cast restores movement; idle and charge do not lock it.

## Inventory And Profile

Inventory shows a schematic angler and five equipment slots on the left, with the gear catalog on the right. Click a slot to open its category. Buy gear with local coins; equip owned gear by clicking its card or Equip button, or by dragging it to the matching slot. Wrong-slot, unowned, and flight-time drops are rejected. Float depth and the actual cast range are shown below the slots. Mobile layouts stack the equipment area above the scrollable catalog.

New profiles start with 100 coins, the Bamboo 4m rod, Mono 0.20 mm line, Single Hook #8, and 10 earthworms. Existing Stage 4 profiles retain their selected rod for free and receive four earthworms. Each successful water landing consumes one selected bait and records a successful cast; an empty bait stack never blocks casting. Late ground collisions record an unsuccessful cast without spending bait. Pre-release rejections do not count as completed casts. Purchases, equipment, and zero-count bait stacks persist locally. No coins are awarded in this stage. Lures can be stored, but lure-only casting and an equipped lure remain deferred.

Profile has Profile, Catch log, and Statistics tabs. The catch log is empty until a future fishing stage; fish-related counters stay at zero. Playtime accumulates whole seconds while playing, including time in drawers but excluding the title and pause menu. Regression tests cover camera-ray aim, rejection recovery, range caps, matching equipment slots, ownership checks, drag locks, repeated view-switch stability, shallow casts, the shared water surface, live preview validation, fine float adjustment, proximity retrieval, the skinned character model, a single fixed-color cast marker, fixed development noon, optional Moscow wall-clock time across device time zones and midnight, and ambient migration/persistence without muting events. Run the complete suite with `node --test tests/*.test.mjs`.

## Character Rig

HF6 uses a separate lowered cast-hold pose: the elbow stays below the shoulder and the forearm and rod remain parallel to the water during flight and waiting. The grip is anchored to the player's world pose, never the rendering camera's aspect or orbit. Canonical player-look pitch adds only 0.03 meters of fore/aft correction per radian (at most 0.045 meters), preserving fine inward/outward float adjustment without lifting the arm. The same sleeve and hand stay visible in first person when looking forward or toward nearby water; looking away may naturally move them out of frame. Release previews predict this exact pose without changing live bones. Walking carry and the idle first-person pose are unchanged.

The local character is an original low-poly skinned angler with a face, coral cap, teal jacket, pale cuffs, grey trousers, and dark boots. `src/characterModel.js` authors 3,256 triangles locally in the existing neutral rig space, with normalized skin weights for the torso, elbows, wrists, hips, and knees. It uses the same 24-bone skeleton and hand sockets, without a downloaded model, asset loader, CDN, external textures, or engine conversion. [Human Basic Motions FREE](https://kevdev.itch.io/basic-motions-free) was reviewed as a reference, but no third-party model or animation files are bundled. Rebuilding the world releases the old model geometry, materials, and skeleton texture.

`src/angler.js` exposes `group` (world placement), `rig` (local facing and bone hierarchy), `bones` (named `THREE.Bone` references), `skeleton` (the `THREE.Skeleton` with neutral T-pose bind matrices), `model` (the bound character meshes and materials), and `visuals` (the hidden skeleton preview). Standard `THREE.AnimationMixer` clips blend idle, walking, running, and wading. Cadence follows actual horizontal travel, so pressing into a blocked surface stops the gait. The model turns toward travel and freezes in pause. First-person view uses the same skinned right sleeve, cuff, and hand in the existing view pass while hiding the torso, head, other limbs, and tackle box; no alternate arm is generated.

Future replacement models need skin weights and a compatible bind pose, or a bone mapping and retargeting step. Attach a compatible skinned model to the rig and bind it to the provided skeleton with an explicit bind matrix matching its neutral pose; do not recalculate bone inverses from the live animated pose. Hide `model.group` when a replacement is ready and keep `visuals` hidden unless inspecting the skeleton. Arbitrary unrigged models will not animate simply by being placed over the preview. A file loader and asset-specific mapping can be added with actual uploaded models. Model tests check the triangle budget, valid normalized weights, finite animated vertices, actual mesh deformation, stable identities and bind matrices, grip attachment, pause, and first/third-person visibility on wide and portrait viewports.

`src/carryProps.js` builds a closed tackle box with a handle in the anatomical left hand and a rod with grip, reel, and line guides in the right hand. `angler.carry` exposes the two hand sockets and the replaceable prop groups. The carry poses keep the left arm low and the right elbow bent, with restrained gait-driven sway. Pressing `V` blends the same shoulder, elbow, and wrist into a camera-aligned raised pose using the existing camera transition. Outside an active cast, actual walking, running, or wading raises the rod vertically; stopping smoothly lowers it to the original angled pose. First-person carry stays vertical relative to the view while looking around; third-person carry stays world-vertical. The same wrist rotates without changing the grip. The arm, grip, and lower shaft stay framed on desktop and portrait screens; the upright tip naturally extends above the screen. Pausing freezes the transition, and blocked movement returns to the resting pose. No arm, rod, socket, or skeleton is cloned or reparented, and bind matrices remain unchanged. Stage 4 retains these carry poses and overlays a horizontal hold after release, without adding inventory UI.

Development checks (Node 24, test tooling only):

```sh
node tests/character-rig.test.mjs
node tests/first-person.test.mjs
node tests/carry-stance.test.mjs
node tests/cast-system.test.mjs
node tests/cast-integration.test.mjs
node tests/cast-movement.test.mjs
node tests/float-rig.test.mjs
node tests/movement.test.mjs
node tests/spawn-boundary.test.mjs
```

The tests cover bone hierarchy, stable bind matrices and limb lengths, locomotion blending, blocked idle, pause, camera visibility, deformation of a weighted test vertex, hand attachment stability, anatomical prop sides, rod length and orientation, tackle box ground clearance, first-person framing across camera angles and aspect ratios, interrupted view transitions, stable object identities, upright moving carry, smooth lowering, frame-rate independence, and restoration of the resting pose. Cast tests cover the canonical physics function, constants, slower charge and flight timing, accuracy, prediction/flight agreement at 30/60/144 Hz, 50 finite scenarios, 36 distance checks across all three ranges and four charge fractions, strict maximum distance, water-only release, sky/land/dock/rock rejection, exact release revalidation, recovery after a late obstruction, pause, real rod-tip attachment, stable world-space origin, audio, UI gates, rendered shoreline masking, and non-stretching rod selection. Horizontal-hold tests cover all rod lengths, gaits, camera blends, yaw and pitch angles, desktop/mobile framing, pause, smooth restoration, stable model identities and bind matrices, unchanged release origins, and frame-rate-independent transitions. Cast-movement tests cover immediate position locking, suppressed footsteps and splashes, walking and sprint inputs, recovery, camera look, and movement restoration at 30/60/144 Hz. Float-rig tests cover fixed polyline length, the underwater drop, all three rods and multiple depths, depth-adjusted landing distance, sideways float adjustment with slack, reach constraints, water and obstruction gates, pause, depth validation, equipment gates, and saved depth values. Shallow-cast tests cover 1- and 1.5-meter throws, bottom contact without changing the line budget, rendered triangle/query agreement, static opaque water, live meter validation in both directions, immediate retry, and a non-mutating forecast of the settled grip. The view pass draws the same arm meshes after the world with normal depth between their parts, so nearby terrain cannot cut through the arm or rod. The app itself still runs without Node.

## Stage 4 Casting

`src/castSystem.js` exports `SnejCastSystem`, the cast constants, and the reference range helpers. It has no Three.js, DOM, or audio dependency. Its states are `idle`, `charge`, `flight`, and `wait`. `src/rods.js` defines 4-, 5-, and 6-meter rods with zero-depth reach of 8, 10, and 12 meters. The actual cast limit is twice the rod length minus the selected float depth: a 5-meter rod at 0.5 meters depth has a 9.5-meter limit. Rod selection and Float depth (m) live exclusively in inventory, not the pause menu. The defaults are 4 meters and 0.5 meters depth, giving a 7.5-meter limit. The HUD shows the rod's zero-depth reach, selected depth, fixed line length, and bait count; inventory and the cast meter show the depth-adjusted limit. Save schema version 5 stores inventory, catch log, and statistics under the existing player record. The equipped inventory rod is canonical; settings.rodLength is derived. Cast state is never saved or sent to multiplayer.

Charge is a triangular wave at 0.4 per second, preserving time across endpoints: 2.5 seconds up and 5 seconds per cycle. The meter measures distance divided by the depth-adjusted cast limit, with a numeric distance/limit readout and the clipped +/-0.06 tolerance band. At 0.5 meters depth, 50% means 3.75, 4.75, or 5.75 meters. The launcher solves velocity for this distance; perfect feedback never silently changes it. Aim follows the actual rendered camera ray intersecting the flat water datum, clamped to minimum throw distance and rod range. Third-person orbit pitch is not treated as a first-person look angle. The launch direction follows that camera target; looking above the horizon is invalid, not permission to cast.

The reference `flightRange` and `castTopSpeed` formulas are retained. Prediction and flight use gravity 9.8, drag 0.0055, and the same fixed 0.055-second integration steps. Both clip the final segment to the water plane, avoiding distance jumps when the number of steps changes. A distance solver uses the same clipped integration and the player's release position, choosing the lower velocity bound so full charge cannot exceed the selected limit. Flight runs at 0.65 simulation seconds per real second and interpolates between steps. Predictions refresh every charge frame with the same validation used on release. The minimum requested distance is 1 meter, or the minimum needed to clear the virtual launch origin when that is farther. There is exactly one cast ring, with a fixed cyan color and size. In idle it forecasts a throw at the camera-target power, including the real release-origin offset; while charging it follows the actual current ballistic prediction up to the rod/line/depth limit. No separate target or landing ring is created. The ring is hidden on non-water surfaces, invalid land/sky aim, flight, waiting, and blocking UI. An obstructed prediction over visible water retains the same color; release is still blocked and explained by the meter. Invalid charge remains red in the meter; an invalid ideal landing also turns the tolerance band red. Current water depth, bottom contact, or the reason for a blocked release is shown before releasing. A hidden ring does not restrict walking or sprinting before release.

Accuracy remains continuous: distance-fraction errors up to 0.06 are perfect, falling linearly to zero at 0.30. Accuracy and distance fraction scale splash particles, ripples, and synthesized landing audio. Before release, the exact current trajectory is recalculated. Aim and landing require visible open water with no terrain, dock, rock, or line obstruction. Any positive visible depth accepts a cast; neither a 0.25-meter threshold nor selected hook depth can reject shallow water. Water beyond the equipped rod's reach reports that it is out of reach when the capped aim point is land. The fixed rig's line check has no obsolete vertical sag. Charge previews forecast the settled horizontal rod tip from the existing hand pose, without changing live bones. An idle rod pointing into the ground while looking down cannot falsely reject a throw that will level the rod. The water mask and all casting ground/depth checks use the rendered terrain triangles below the same flat water datum, excluding visible land and objects covering water. Invalid releases stay idle with no bobber or line. Each new attempt clears the previous preview, rejection, and flight buffers; starting a charge hides the old error. Rejection messages distinguish aim, reach, charge distance, land, dock, and rock. Automatic recovery at 9 meters per second remains a safety fallback for late obstructions or an unreachable line constraint. A successful water landing remains in `wait` on the shared water plane, with a purely visual 0.012-meter bob at frequency 1.6. Another left-mouse hold replaces the waiting bobber; it does not implement reeling or the later fishing loop.

Rod selection changes the existing hand-attached model to its actual butt-to-tip length. Only the shaft is extended; the grip and reel retain their dimensions. Section bands, guides, and guide line follow the new shaft. No meshes, geometry, bones, or sockets are recreated. Rod and depth selection are disabled during charge, flight, and recovery; changing either while waiting clears the old float. Depth ranges from zero to rod length minus 0.25 meters. Outside an active cast, existing walking carry and first-person arm raising are unchanged.

`src/floatRig.js` implements the fixed float rig without Three.js or DOM dependencies. Total line length equals rod length; float depth reserves that amount for the segment below the float, and the remainder connects the physical rod tip to the float. The rod's own reach plus this upper segment produces the requested maximum cast rule. A 33-point sideways slack curve is solved to retain the exact upper-line polyline length instead of stretching between endpoints. The hook drops to the selected depth, or stops 0.02 meters above the rendered bed when shallower (never above the surface). `actualDepth` tracks the drop and `bottomSlack` tracks the remaining reserved lower-line length, so bottom contact never increases the upper-line budget or maximum range. Opaque water naturally hides the underwater segment from an above-water camera. During flight the full fixed line is available, and the rendered float is constrained to the rod-tip radius while the existing ballistic simulation drives the throw.

In `wait`, horizontal displacement of the actual rod tip moves the float, including sideways adjustments with slack. The float stays on valid water, inside the available upper-line sphere and the depth-adjusted reach from the player. Its movement is checked in 0.15-meter steps against water and obstacles. Blocked movement stops at the last valid position; if the rod can no longer reach that position, the safety recovery returns the rig rather than stretching the line. This runs after the animated wrist pose so the constraint uses the same model the player sees in either camera mode. Pause and blocking drawers freeze float adjustment. Walking and sprinting remain locked while the rig is out.

Released casts temporarily use 3% of the configured mouse sensitivity, with combined yaw/pitch motion capped at 0.06 radians per second. Excess mouse input is discarded, not queued, so a fast swipe cannot cause a delayed sweep. Normal sensitivity returns in idle and charge without changing the saved setting. Reversing a float adjustment first takes up the prior rod-tip travel on each horizontal axis, capped at 0.12 meters of free play; further opposite travel moves the float back. This bounded free play cannot override the fixed line, water, or obstruction constraints and resets with the cast.

An inward player correction automatically retrieves the rig when the float's horizontal distance from the player becomes less than 40% of total line length: 1.6, 2.0, or 2.4 meters for 4-, 5-, or 6-meter line. The selected float depth does not change this threshold. A short landing, outward correction, pose settling, view switch, pause, or blocking drawer alone cannot trigger it. Proximity retrieval uses the existing recovery animation, locks walking until completion, and does not record a failed cast or consume another bait. Fine-adjustment tests cover all rods, several depths, 30/60/144 Hz, diagonal speed caps, discarded input, neutral return, bounded free play, exact thresholds, short casts, pause, and recovery completion.

After release, the same wrist smoothly levels the rod parallel to the world water plane during `flight` and `wait`, in both camera modes. This hold pose takes priority over upright walking carry, including when looking up or down in first person. A held cast uses one world-space grip based on the player's eye and look direction, independent of the rendered camera's orbit. Switching views, including interrupted transitions, does not pull the physical rod tip or float toward the player or initiate line recovery. Actual rod movement still adjusts the float, and the fixed line retains its length. Starting a new charge, changing equipment, or automatic recovery restores the ordinary carry pose. Pause freezes the blend. The rod stays attached to the same hand; no model, socket, bind matrix, or release-origin logic changes.

The virtual release origin is 0.55 meters forward at shoulder height 1.25, transformed by the actual character group and local facing. It never samples the animated wrist. The rendered line instead uses the existing physical `carry.tip`, not the brief's wrist proxy. This adapts the brief to the current rig without changing the pose system. The water mesh, `surfaceY`, and `waveHeight` share the static zero-height plane. Procedural water color remains static and opaque; vertex relief cannot expose water over land while physics uses a different shore. Markers, splashes, and the waiting float use this same plane and rendered terrain triangles.

Build Mode owns its existing pointer listeners; casting uses separate left-mouse listeners and is available to all ranks outside blocking UI. Pause, profile, Build Mode, and loss of window focus cancel charge. Pause and blocking drawers freeze flight and automatic recovery. Flight, water wait, and recovery lock character movement without stopping casting or camera look. The mouse wheel, view switch, ranks, textures, and schema version 4 are unchanged.

`castLead` is always zero. Swing animation and timed release are deferred to Stage 4.5. Bait, fish, bites, hook/fight/catch systems, casting multiplayer sync, and reel sounds are deferred to Stage 5+. Setting `window.__snejDebug = true` logs the future startle radius/duration formula on water landing without creating any fish system.

## Registration And Ranks

First launch requires a local player name. Names are 3 to 20 ASCII characters, may contain letters, numbers, underscores, and hyphens, and cannot begin with a number. ID `1` is reserved for Snejkov, so the first normal browser-local ID is `2`; signing out preserves the next counter so a later registration receives the next sequential ID. The profile shows name and ID only, supports name changes without changing ID, and provides the Sign Out action.

Ranks are derived at runtime and are never saved or shown in the local profile. Stage 3 exposes `player`, `premium`, `tester`, `administrator`, and `developer`; only `player` and `developer` are assignable in this build. `Snejkov` with ID `1` is the hardcoded developer account. Multiplayer peer rows show the derived rank.

To bootstrap the developer profile once on its browser, run this in the browser console:

```js
localStorage.setItem('snejfishing-bootstrap-v1', 'snejkov');
location.reload();
```

The bootstrap flag skips Registration and creates `Snejkov [#1]`. Registering with the exact name `Snejkov` also restores the reserved developer identity. Older saves named `Snejkov` with another ID, or any legacy profile occupying reserved ID `1`, are corrected to `Snejkov [#1]` on load. Remove the flag manually before signing out if the browser should return to normal registration.

## Build Mode

Developer profiles can upload PNG, JPG, or WEBP textures up to 8 MB with dimensions from 32 to 4096 pixels. Textures use SHA-256 hashes and stay in IndexedDB database `snejfishing-media`, object store `mediaTextures`. Texture names support inline rename with Enter to save and Escape to cancel.

JSON export contains metadata only and uses schema `snejfishing-texture-manifest-v1`; image blobs are never exported. Imported metadata is non-destructive and deduplicated by hash. Records without local blobs display and place a generated fallback texture.

## Saves

The game uses localStorage keys `snejfishing-save-v1` and `snejfishing-bootstrap-v1`. Stage 1, Stage 2, and Stage 3 saves migrate to schema version 4 automatically. The schema stores settings, fixed seed, local identity, the active spawn name, player position and view, room, and placement references. Rank is not persisted. A profile exists only in the browser where it was registered; a browser without that local save opens registration instead.

The launcher always shows the saved local profile before entry. Snej Lake is the available waterbody; Pine Reservoir, Northern River, and Marsh Lake are visible as locked `Soon` destinations.

New registrations start at `initial`. When a configured or saved spawn is deeper than the one-meter wading limit, the game moves the player to the validated land start beside the dock. The complete spawn table in `src/spawns.js` also defines `alpha`, `bravo`, `charlie`, and `delta`; spawn selection UI remains deferred.

The fixed map seed is `0x534E454A`. The lake is resolved through the 16-check validator. Water is opaque and its shader surface is static; terrain collision prevents the player from entering water deeper than `1.0` world unit.

## Multiplayer Scaffold

The optional `server/` guest demo replaces the scaffold when its health endpoint
advertises `entry:guest`. Entry asks for a nickname only, never a password.
Server-issued IDs and guest sessions isolate profiles; choosing a nickname
cannot claim owner ID 1 or developer permissions. Two independent browser
sessions in `snej-1` receive real connected-player presence. `Tab` toggles the
live player roster, including paused players; actual disconnects remove peers.
Settings, named gear sets, purchases, equipped items, and position use the
durable guest database, not the existing browser-local owner's save. Losing a
guest cookie does not allow profile recovery by nickname. New gameplay stats
remain session-local until an authoritative cast/activity recorder is added.
See `server/README.md` and `server/GUEST_DEPLOYMENT.md` for verification scope,
isolated operation and rollback. Public guest HTTP is not private-account login;
account endpoints are disabled. No owner import or currency grant is applied.

Add `?mp=1` to show Online. A normal localhost preview reports an offline scaffold, so solo play has no server dependency. Add `?mp=1&mpconnect=1` when a compatible `/ws` endpoint is available.

The optional Cloudflare Worker in `worker/` relays raw WebSocket messages, reserves developer ID `1`, assigns unique global IDs, and accepts optional KV binding `SNEJFISHING_GLOBAL`. Without KV it warns and uses module-memory ID state. Presence runs at 10 Hz and includes ID, name, and rank.

## Project Layout

- `index.html` and `styles/`: game shell and UI.
- `src/`: Three.js world, spawn table, controls, identity, storage, placement, and multiplayer modules.
- `vendor/`: local Three.js module.
- `worker/`: optional WebSocket relay.

Fish, bait, bite, fight, and catch systems remain intentionally deferred. Stage 4 provides local casting only.
