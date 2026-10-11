const validCatch = (entry) => entry && typeof entry.species === "string" && entry.species.trim()
  && Number.isFinite(entry.length) && entry.length > 0 && Number.isFinite(entry.weight) && entry.weight > 0;

export class SnejCatchLog {
  constructor(initial = null) {
    this.entries = Array.isArray(initial?.entries)
      ? initial.entries.filter(validCatch).map((entry) => ({ ...entry })) : [];
  }

  serialize() { return { entries: this.entries.map((entry) => ({ ...entry })) }; }

  addCatch({ species, length, weight, location, time } = {}) {
    if (!validCatch({ species, length, weight })) return false;
    const timestamp = Number.isFinite(time) && time > 0 ? time : Date.now();
    this.entries.unshift({
      id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      species: species.trim(), length: Math.round(length * 10) / 10, weight: Math.round(weight * 100) / 100,
      location: typeof location === "string" ? location : null, time: timestamp
    });
    return true;
  }

  count() { return this.entries.length; }
  bestLength() { return this.entries.reduce((best, entry) => Math.max(best, entry.length), 0); }
  totalWeight() { return Math.round(this.entries.reduce((sum, entry) => sum + entry.weight, 0) * 100) / 100; }
  uniqueSpeciesCount() { return new Set(this.entries.map((entry) => entry.species)).size; }
}
