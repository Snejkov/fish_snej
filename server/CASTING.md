# Casting contract

The browser previews a forward target from held cast strength. Online casting requires an
authenticated, current WebSocket lake connection. Release immediately starts
a predicted local flight to the frozen circle while approval runs in parallel.
A denial or connection loss clears that prediction without altering progress.
Static/offline hosting keeps local casting.

- `POST /api/cast/start`: `{requestId,target:{x,y,z}}`. The server assigns the
  cast ID, identity, approval time, accepted player origin, owned gear and
  depth snapshot. It checks finite coordinates, rendered shoreline, dock,
  exposed rocks, minimum distance and the equipped line-minus-depth budget.
- `POST /api/cast/land`: `{castId,landing:{x,y,z}}`, sent only when the actual
  simulated float transitions from flight to water and approval has arrived.
  An early local landing waits for approval and the minimum age before reporting
  its captured endpoint; retrieval stays disabled until confirmation. The server
  requires the
  same session and connection, live approved intent, unchanged gear/depth,
  age 50 ms to 30 seconds, and a landing within 0.03 world units of the
  approved point and still within the range budget.
- `POST /api/cast/cancel`: `{castId}`. Cancelled, superseded or expired intents
  cannot produce a successful landing. Invalid input cannot upload user IDs,
  timestamps, equipment, success, fish or reward claims.

The additive SQLite `casts` table stores the server-owned ID, user, session
hash, connection, origin, target, gear/depth, approval time, actual reported
landing and server landing time. With no bite mechanic in this stage, a
successful landing and retrieval preserve the equipped bait quantity.
There is no client refund/grant operation and no retroactive stock refill.
Exact retries are idempotent; changed retries are rejected.
No catch or money is awarded by this contract. Existing profiles and balances
are preserved. Guest nickname persistence has its existing browser/session
limitations; this change does not add permanent account registration.

Missing, unowned, invalid or depleted bait returns `bait_unavailable` and
displays `No bait.`. Other missing/incompatible gear returns
`cast_gear_unavailable`; only a missing/current-session lake connection uses
`cast_unavailable` and asks the player to reconnect. The client rejects a
known empty bait stack before charging/releasing, but the server still checks
its own inventory both at approval and landing. No denial refills bait or
changes coins, equipment or profile progress.

## Units and presentation

One world unit is one fishing meter, matching the actual pole mesh. Total
fixed line equals nominal pole length; the upper line and casting range are
that length minus selected depth. A 4m pole with 1m depth therefore has 3m
between tip and float, not 6 world units. Pole meshes are not stretched.
Legacy saved depth is halved once, marked with `fishingUnitsVersion: 2`, to
preserve the formerly displayed choice. Server reads normalize old profiles
without modifying the database; the next ordinary profile/position write
persists the normalized settings. Cached old clients cannot write unversioned
depth and receive `client_update_required`. Player coordinates, inventory,
balances, chat and nameplate radii are unchanged.
The same circle is green for a valid point and red for an invalid
point; an invalid point is never silently moved closer.

PC holds the left mouse button (or optional C) to charge, then releases to cast. The
physical Backquote key toggles free cursor and pointer-lock camera look.
In automatic cursor mode the initial held mouse gesture requests capture,
not the later click after release; manual free-cursor mode is never recaptured.
Primary mouse release is handled in the capture phase through `pointerup`,
with `mouseup` as a compatibility fallback and a once-only held flag.
Touch availability does not disable a real mouse on a hybrid PC, while
touch/pen compatibility events cannot begin or end a desktop mouse cast.
Compatibility suppression refreshes on touch end/cancel too, including a
long-held Safari touch; known physical mouse events remain independent.
Mobile/tablet users hold the mobile-only Cast button, then release to cast;
after landing, Run and Cast are replaced by one Retrieve button. Retrieval
is a single tap, works with the last bait, and does not charge another cast.
It is disabled while landing confirmation or retrieval is in progress;
Run and Cast return when the float reaches the rod. On PC, LMB after landing
first raises the rod smoothly for 0.4 seconds, then retrieves the empty rig.
The same held click or release cannot start a new cast: a fresh press is needed
after retrieval finishes. C cannot reset a landed rig into another charged cast.
Landing confirmation disables this action; blur, menus, pointer cancellation
and disconnect cancel a pending lift. This is not a fish-resistance minigame.
The lift uses the same wrist and is bounded by the real upper-line budget and
obstruction checks. Float corrections follow the unlifted grip, so the visual
lift alone does not move an anchored float.
The rendered line now has gravity sag and slow sway with fixed endpoints.
Its actual polyline length still equals the approved budget, even as slack
takes up; the visual animation does not stretch equipment or change physics.
After landing, phones/tablets show a hold-to-Squint button; PC holds physical Z.
It smoothly magnifies the float 1.5x using FOV and a rendered-only look target.
The physical casting camera, player look, position and cast range stay unchanged.
Release restores the normal view. Retrieval, menus, blur, resize, disconnect
and view changes clear zoom; a fresh press is needed. Text input, modified
shortcuts and key repeat cannot start squinting. No saved settings are changed.
The normal landed first-person view also smoothly centers the float and moves
only the observer 0.155 to 0.22 world units left (less on narrow portrait screens),
framing the same physical hand/rod to
the right. It does not pose or relocate the grip, tip, player or casting camera.
Choosing third person restores the independent orbit; joystick rod corrections
keep their existing physical line constraints.
On phones and tablets, the first-person joystick gently adjusts the rod after
landing, without walking. It has a separate 0.07 rad/s analog rate and a smooth
0.1 second response, independent of camera sensitivity. Combined swipe/mouse
and joystick corrections share a 0.12 rad/s cap and the existing float-line
physics. Release, pause and input cancellation stop immediately without drift.
Changing between rod and movement modes clears only the held joystick touch:
a fresh touch is needed, while a separate camera finger remains independent.
Both analog rod adjustment and post-cast mouse/swipe sensitivity are twice
their previous rates; the smooth response and immediate stop are unchanged.
Walking and pre-cast camera sensitivity are unchanged. Touch-enabled phones
and tablets use a closer 3.3 world-unit third-person orbit, while desktop keeps
4.6. The same terrain and obstacle pull-in checks apply to the chosen orbit.
First-person physics, fixed targets and manual view transitions are unchanged.
Ordinary screen swipes still look around. Strength grows monotonically to
the maximum in about 2.08 seconds (20 percent faster accumulation) and stays
there without automatically throwing.
Casting follows the rendered camera ray projected to the water plane, then
measures the charged distance from the player along that direction. This
accounts for third-person orbit parallax; camera pitch is not copied from
the orbit controls. The ring previews the charged endpoint and is not draggable.
Looking around remains available during the hold without immediately turning
the character. A camera ray that cannot meet water is invalid, not silently
clamped. Strength appears as an accessible, slim framed bar centered at the top,
20 percent of viewport width, with a safe-area inset and no bulky text/card.
Too-short releases report insufficient strength rather than blaming open water.

Release freezes the target, power and flight pitch and launches immediately.
The character then smoothly turns by the shortest angle over 0.16 to 0.65
seconds. Turning and predicted flight are entirely client-side and never wait
for the save/request queue. The server still approves the exact target, gear,
depth and range before accepting a landing. Success is recorded only after
that landing is confirmed. Rejection resets only the current prediction;
obsolete replies cannot revive it or cancel a newer throw. A short flight
may reach water before approval, but it cannot report success or retrieve
until the server confirms. Ordinary pause or menus freeze the launched
flight; connection loss, reset or changed player origin invalidate it.
Other players receive this visual facing,
not the independent aiming camera angle. Later camera changes cannot retarget
the throw. Prediction uses the future turned grip; the final physical throw
uses that same aligned grip and exact endpoint. Touch cancellation, blur and
menus cancel an unreleased charge, not an already flying prediction. Disconnect,
reset and changed player origin invalidate the prediction and any late approval.
All devices currently stay in first person; the retained
third-person camera cannot be selected.

## Authority boundary

This is an approved-intent and validated-endpoint foundation, not a fully
authoritative movement or ballistic simulation. Accepted peer positions
still originate in existing client presence/profile updates. The server
does not yet reconstruct the full flight path or prove that a physical
client animation occurred. It therefore does not promise total cheat
prevention. Deployment does not enable new fish AI or fighting mechanics.

For future fishing: client graphics/assets/animation and responsive local
reeling prediction stay client-side. Fish selection/size, equipment
properties, chance/load/break calculations, final outcome, catch and rewards
must be decided on the server from player actions, not trusted client result,
random-roll or reward claims. No such full fishing system is implemented here.

## Verification

Run `node --test tests/*.test.mjs` in the project root and
`node --test server/tests/*.test.mjs` with the pinned server dependencies.
The browser-only fixtures `tests/target-cast-browser.html` and
`tests/desktop-cast-browser.html` run against isolated local static hosting,
not production profiles. Native-touch emulation is not a real iPhone Safari
device test. The production server deliberately does not serve `/tests/`.
