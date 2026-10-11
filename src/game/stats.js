const DEFAULT_STATE = Object.freeze({
  castCount: 0, successfulCasts: 0, fishCaught: 0, bestLengthCm: 0,
  totalWeightKg: 0, uniqueSpecies: 0, playtimeSec: 0, lastSeenAt: 0
});

export class SnejStats {
  constructor(initial = null) {
    this.state = { ...DEFAULT_STATE };
    for (const key of Object.keys(DEFAULT_STATE)) {
      const value = initial?.[key];
      if (Number.isFinite(value) && value >= 0) {
        this.state[key] = ["bestLengthCm", "totalWeightKg"].includes(key) ? value : Math.floor(value);
      }
    }
    this.state.successfulCasts = Math.min(this.state.castCount, this.state.successfulCasts);
    this._playtimeFraction = 0;
  }

  serialize() { return { ...this.state }; }

  recordCast(success) {
    this.state.castCount += 1;
    if (success) this.state.successfulCasts += 1;
  }

  recordCatch({ length, weight } = {}) {
    if (!Number.isFinite(length) || length <= 0) return;
    this.state.fishCaught += 1;
    this.state.bestLengthCm = Math.round(Math.max(this.state.bestLengthCm, length) * 10) / 10;
    if (Number.isFinite(weight) && weight > 0) {
      this.state.totalWeightKg = Math.round((this.state.totalWeightKg + weight) * 100) / 100;
    }
    // Catch log will supply uniqueSpecies in Stage 5B.
  }

  tickPlaytime(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this._playtimeFraction += dt;
    const seconds = Math.floor(this._playtimeFraction + 1e-9);
    this.state.playtimeSec += seconds;
    this._playtimeFraction = Math.max(0, this._playtimeFraction - seconds);
  }

  stampSeen() { this.state.lastSeenAt = Date.now(); }
}
