/** Namespaced localStorage helper (mirrors the mockup's `LS`). */
export const LS = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem("sprint0_" + key);
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      return def;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem("sprint0_" + key, JSON.stringify(value));
    } catch {
      /* ignore quota / disabled storage */
    }
  },
};
