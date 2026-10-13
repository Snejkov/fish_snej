# Fixed pole and line checks

The landed rig does not copy pole-tip travel into the float. Its line has an
exact, unchanging total length. Slack applies no force and cannot push a float.
Once the rod-tip-to-float distance reaches the upper-line budget, a hard rope
constraint pulls the float immediately. Light float inertia is water-damped;
it cannot extend the line. The small elastic reserve from the prior version
has been removed. Visual sway is subtle and preserves the polyline length.

The upper-line budget is the total line minus the selected float depth. The
pole mesh, physics and UI all use one world unit per fishing meter: a 4m
pole has 4m of total line, and 1m depth leaves 3m from tip to float. Legacy
saved depth is halved once to preserve its displayed value, with version 2
preventing repeat conversion. Server validation shares the same budget and
rejects obsolete unversioned depth writes. Ownership and balances are unchanged.
Bottom contact reserves unused leader slack.
Automatic post-cast pose settling clears momentum; pause freezes the solver.
Reset clears momentum. Shoreline and straight-line obstruction checks remain
active. An impossible configuration requests the existing retrieval path.

Retrieval raises the pole and lifts the rig before the main swing to the hand.
It does not reel in or replace the fixed-length rig. The original hand anchor,
visible hook catch, terrain clearance, and eventual movement unlock remain.

`fixed-pole.test.mjs` exercises slack, release/reversal, exact taut limits,
frame-rate consistency, bounded stalls, render endpoints, pause/reset,
displayed lengths, repeated side sweeps with the actual 4/5/6m model,
slack-to-pull transitions, shoreline safety, and pole-first
retrieval with the actual angler and cast system. The float, mobile-input,
pose, and retrieval regressions also cover
the new behavior. The tension value is a foundation for future fish loads;
this change does not implement bites, fish forces, line breaking, or rewards.
