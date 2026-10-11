const MOSCOW_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Moscow",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export function moscowHour(now = Date.now()) {
  const date = new Date(now);
  const parts = Object.fromEntries(MOSCOW_CLOCK.formatToParts(date).map(({ type, value }) => [type, value]));
  return Number(parts.hour) + Number(parts.minute) / 60
    + (Number(parts.second) + date.getUTCMilliseconds() / 1000) / 3600;
}

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export class SnejWorldClock {
  constructor({ fetchTime = globalThis.fetch, deviceNow = () => Date.now(), elapsedNow = () => performance.now() } = {}) {
    this.fetchTime = fetchTime;
    this.deviceNow = deviceNow;
    this.elapsedNow = elapsedNow;
    this.source = "device";
    this.serverTime = null;
    this.serverAt = 0;
    this.lastAttempt = -Infinity;
    this.pending = null;
  }

  hour() {
    const now = this.serverTime === null
      ? this.deviceNow()
      : this.serverTime + this.elapsedNow() - this.serverAt;
    return moscowHour(now);
  }

  refresh(force = false) {
    if (this.pending) return this.pending;
    if (!force && this.elapsedNow() - this.lastAttempt < SYNC_INTERVAL_MS) return;
    this.lastAttempt = this.elapsedNow();
    this.pending = this.sync().finally(() => { this.pending = null; });
    return this.pending;
  }

  async sync() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = new URL(import.meta.url);
      url.searchParams.set("clock-sync", `${this.deviceNow()}-${Math.random()}`);
      const start = this.elapsedNow();
      const response = await this.fetchTime(url.href, { method: "HEAD", cache: "no-store", signal: controller.signal });
      const end = this.elapsedNow();
      const age = response.headers.get("Age");
      const cacheStatus = [response.headers.get("X-Cache"), response.headers.get("CF-Cache-Status")].join(" ");
      const serverTime = Date.parse(response.headers.get("Date"));
      if (!response.ok || !Number.isFinite(serverTime) || end - start > 5000
        || (age !== null && (!Number.isFinite(Number(age)) || Number(age) > 0))
        || /\b(HIT|STALE|UPDATING)\b/i.test(cacheStatus)) return false;
      // HTTP Date has one-second precision; estimate the return-trip delay.
      this.serverTime = serverTime + (end - start) / 2;
      this.serverAt = end;
      this.source = "http-date";
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
