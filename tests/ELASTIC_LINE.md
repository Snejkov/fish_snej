# Elastic pole and line checks

The landed rig no longer copies pole-tip travel into the float. The upper line
has its configured rest length, gravity sag, and at most 2.5% elastic reserve
(capped at 0.25 world units). Slack applies no force and cannot push a float.
Extension pulls the float against water drag and inertia in bounded substeps.
The visible line shares the physical float endpoint and elastic length.

The reserve does not change the gear's line length, depth, cast range, server
validation, or ownership. Bottom contact still reserves unused leader slack.
Automatic post-cast pose settling suppresses pull; pause freezes the solver.
Reset clears momentum. Shoreline and straight-line obstruction checks remain
active. An impossible configuration requests the existing retrieval path.

Retrieval raises the pole and lifts the rig before the main swing to the hand.
It does not reel in or replace the fixed-length rig. The original hand anchor,
visible hook catch, terrain clearance, and eventual movement unlock remain.

`elastic-pole.test.mjs` exercises slack, release/reversal, delayed tension,
frame-rate consistency, bounded stalls, render endpoints, pause/reset,
shoreline safety, and pole-first retrieval with the actual angler and cast
system. The float, mobile-input, pose, and retrieval regressions also cover
the new behavior. The tension value is a foundation for future fish loads;
this change does not implement bites, fish forces, line breaking, or rewards.
