# SnejFishing v0.0.04 Stage 4

Stage 4 is a browser-only Three.js lakeside sandbox with local rod casting: charge, aim, release, ballistic flight, landing feedback, and a floating bobber. It preserves the animated 24-bone angler, hand-attached carry props, profile launcher, waterbody selection, validated Snej Lake, safe spawns, static opaque water, corrected movement, one-meter wading, first-person and third-person cameras, developer Build Mode, synthesized audio, and optional raw WebSocket multiplayer scaffold.

## Run

Start any static file server in this folder. For example:

```sh
python -m http.server 8000
```

Open `http://localhost:8000/`. The game needs no Node runtime, package install, build step, CDN, webfont, native module, or downloaded media asset. Three.js is stored locally in `vendor/`.

## Controls

- `W/A/S/D`: move and strafe.
- `Shift`: sprint.
- Mouse: look after clicking the canvas.
- Hold left mouse: charge a cast; release to throw. A new hold after water landing clears the previous bobber and starts another cast.
- `V`: switch between first-person and third-person view.
- `B`: open or close Build Mode in third-person view when the derived rank is developer.
- `P`: open or close the profile drawer.
- `Esc`: close the active drawer or open and close the pause menu.
- `U`: toggle the HUD.

The third-person camera distance is always `4.6`. The mouse wheel is not captured by the game and works normally in scrollable UI.

Movement follows the rendered camera at every yaw: `A` always moves toward screen-left, `D` always moves toward screen-right, and diagonal input is normalized. Releasing movement keys eases the character animation back to idle.

## Character Rig

The local character is a visible 24-bone humanoid rig with hips, spine, chest, neck, head, shoulders, elbows, wrists, knees, ankles, and toes. Cyan marks the left limbs, coral marks the right limbs, and pale links mark the torso. There is no opaque body model yet.

`src/angler.js` exposes `group` (world placement), `rig` (local facing and bone hierarchy), `bones` (named `THREE.Bone` references), `skeleton` (the `THREE.Skeleton` with neutral T-pose bind matrices), and `visuals` (the removable skeleton preview). Standard `THREE.AnimationMixer` clips blend idle, walking, running, and wading. Cadence follows actual horizontal travel, so pressing into a blocked surface stops the gait. The preview turns toward travel and freezes in pause. First-person view keeps the existing right arm visible while hiding the torso, head, other limbs, and tackle box.

Future models need skin weights and a compatible bind pose, or a bone mapping and retargeting step. Attach the compatible skinned model to the rig and bind it to the provided skeleton with an explicit bind matrix matching its neutral pose; do not recalculate bone inverses from the live animated pose. Hide `visuals` when the model is ready. Arbitrary unrigged models will not animate simply by being placed over the preview. The model loader and asset-specific mapping can be added with the actual uploaded models.

`src/carryProps.js` builds a closed tackle box with a handle in the anatomical left hand and a rod with grip, reel, and line guides in the right hand. `angler.carry` exposes the two hand sockets and the replaceable prop groups. The carry poses keep the left arm low and the right elbow bent, with restrained gait-driven sway. Pressing `V` blends the same shoulder, elbow, and wrist into a camera-aligned raised pose using the existing camera transition. Actual walking, running, or wading raises the rod vertically; stopping smoothly lowers it to the original angled pose. First-person carry stays vertical relative to the view while looking around; third-person carry stays world-vertical. The same wrist rotates without changing the grip. The arm, grip, and lower shaft stay framed on desktop and portrait screens; the upright tip naturally extends above the screen. Pausing freezes the transition, and blocked movement returns to the resting pose. No arm, rod, socket, or skeleton is cloned or reparented, and bind matrices remain unchanged. Stage 4 adds casting without modifying these poses or adding inventory UI.

Development checks (Node 24, test tooling only):

```sh
node tests/character-rig.test.mjs
node tests/first-person.test.mjs
node tests/carry-stance.test.mjs
node tests/cast-system.test.mjs
node tests/cast-integration.test.mjs
node tests/movement.test.mjs
node tests/spawn-boundary.test.mjs
```

The rig tests cover bone hierarchy, stable bind matrices and limb lengths, locomotion blending, blocked idle, pause, camera visibility, deformation of a weighted test vertex, hand attachment stability, anatomical prop sides, rod length and orientation, tackle box ground clearance, first-person framing across camera angles and aspect ratios, interrupted view transitions, stable object identities, upright moving carry, smooth lowering, frame-rate independence, and restoration of the resting pose. Cast tests cover the canonical physics function, constants, charge timing, accuracy, prediction/flight agreement at 30/60/144 Hz, 50 finite trajectories, dock/rock/land obstruction, recovery, pause, real rod-tip attachment, stable world-space origin, audio, UI gates, and rendered shoreline heights. The view pass draws the same arm meshes after the world with normal depth between their parts, so nearby terrain cannot cut through the arm or rod. The app itself still runs without Node.

## Stage 4 Casting

`src/castSystem.js` exports `SnejCastSystem`, the cast constants, and the reference range helpers. It has no Three.js, DOM, or audio dependency. Its states are `idle`, `charge`, `flight`, and `wait`. The default rod range is 30 meters; maximum line length is range plus 16 plus 8 meters. Cast state is never saved or sent to multiplayer.

Charge is a triangular wave at 1.05 per second, preserving time across endpoints: about 0.952 seconds up and 1.905 seconds per cycle. The HUD shows charge, required power, and the clipped +/-0.06 tolerance band. Aim follows the look ray intersecting the flat water datum, clamped to minimum throw distance and rod range. Looking above the horizon caps the aim at maximum range.

The reference `flightRange` and `castTopSpeed` formulas are retained. Prediction and flight use gravity 9.8, drag 0.0055, and the same fixed 0.055-second integration steps. Visible flight interpolates between steps. Predictions are refreshed at approximately 12 Hz. The aim ring is cyan, turning green near ideal power; the predicted ring is yellow in deeper water, orange in shallow water, and red for obstruction.

Accuracy remains continuous: power errors up to 0.06 are perfect, falling linearly to zero at 0.30. Perfect releases use the solved target power. Accuracy and power scale splash particles, ripples, and synthesized landing audio. Ground, dock, and rock hits trigger denial feedback and automatically recover the bobber at 9 meters per second. A successful water landing remains in `wait`, with only a 0.012-meter visual bob at frequency 1.6. Another left-mouse hold replaces the waiting bobber; it does not implement reeling or the later fishing loop.

The virtual release origin is 0.55 meters forward at shoulder height 1.25, transformed by the actual character group and local facing. It never samples the animated wrist. The rendered line instead uses the existing physical `carry.tip`, not the brief's wrist proxy. This adapts the brief to the current rig without changing the pose system. Physics uses `surfaceY = 0`; visual markers, splashes, and the waiting float respect existing static water relief and the rendered terrain triangles so they are not buried.

Build Mode owns its existing pointer listeners; casting uses separate left-mouse listeners and is available to all ranks outside blocking UI. Pause, profile, Build Mode, and loss of window focus cancel charge. Pause and blocking drawers freeze flight and automatic recovery. The mouse wheel, movement, view switch, ranks, textures, and schema version 4 are unchanged.

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

Add `?mp=1` to show Online. A normal localhost preview reports an offline scaffold, so solo play has no server dependency. Add `?mp=1&mpconnect=1` when a compatible `/ws` endpoint is available.

The optional Cloudflare Worker in `worker/` relays raw WebSocket messages, reserves developer ID `1`, assigns unique global IDs, and accepts optional KV binding `SNEJFISHING_GLOBAL`. Without KV it warns and uses module-memory ID state. Presence runs at 10 Hz and includes ID, name, and rank.

## Project Layout

- `index.html` and `styles/`: game shell and UI.
- `src/`: Three.js world, spawn table, controls, identity, storage, placement, and multiplayer modules.
- `vendor/`: local Three.js module.
- `worker/`: optional WebSocket relay.

Fish, bait, bite, fight, and catch systems remain intentionally deferred. Stage 4 provides local casting only.
