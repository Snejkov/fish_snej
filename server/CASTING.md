# Casting contract

The browser previews a forward target from held cast strength. Online casting requires an
authenticated, current WebSocket lake connection and server approval before
the local flight starts. Static/offline hosting keeps local casting.

- `POST /api/cast/start`: `{requestId,target:{x,y,z}}`. The server assigns the
  cast ID, identity, approval time, accepted player origin, owned gear and
  depth snapshot. It checks finite coordinates, rendered shoreline, dock,
  exposed rocks, minimum distance and the equipped line-minus-depth budget.
- `POST /api/cast/land`: `{castId,landing:{x,y,z}}`, sent only when the actual
  simulated float transitions from flight to water. The server requires the
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

World/network/physics coordinates and existing saved depths are unchanged.
Fishing display meters equal world units divided by two. Editable displayed
depth converts back to world units by multiplying by two. This applies to
cast range, line length, float depth and water-depth readouts, not player
coordinates, nominal catalog rod names/lengths, chat or nameplate radii.
Equipped line length is now twice nominal rod length; horizontal casting
range is line length minus the raw selected float depth. Pole meshes are not
stretched. The same circle is green for a valid point and red for an invalid
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
Run and Cast return when the float reaches the rod. PC controls are unchanged.
ordinary screen swipes still look around. Strength grows monotonically to
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

Release freezes the target, power and flight pitch. The character smoothly
turns by the shortest angle over 0.16 to 0.65 seconds; the flight waits for
both that turn and server approval. Turning is entirely client-side. The
turning instruction ends when that animation finishes, even without approval;
any remaining network wait is explicitly labeled Waiting for server.
Other players receive this visual facing,
not the independent aiming camera angle. Later camera changes cannot retarget
the throw. Prediction uses the future turned grip; the final physical throw
uses that same aligned grip and exact endpoint. Touch cancellation, blur,
menus, disconnect and changed player origin invalidate the pending turn and
any late approval. Third person changes to first person only after launch.

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
