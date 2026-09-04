import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTheme, nextTheme, saveTheme } from "./theme";
import { THEME_KEY } from "./localData";

// vitest.unit.config.ts runs in a plain Node environment (no DOM), so
// localStorage isn't a global here — loadTheme/saveTheme only touch it, they
// don't need a real browser. A tiny in-memory stand-in is enough to exercise
// the storage round-trip; applyTheme's document.documentElement stamping is
// covered by the browser e2e suite instead (tests/theme.spec.ts).
function fakeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

describe("theme", () => {
  beforeEach(() => { (globalThis as { localStorage?: Storage }).localStorage = fakeLocalStorage(); });
  afterEach(() => { delete (globalThis as { localStorage?: Storage }).localStorage; });

  it("defaults to system when nothing is stored", () => {
    expect(loadTheme()).toBe("system");
  });

  it("round-trips an explicit choice through storage", () => {
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
    saveTheme("light");
    expect(loadTheme()).toBe("light");
  });

  it("clears storage when reset to system", () => {
    saveTheme("dark");
    saveTheme("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(loadTheme()).toBe("system");
  });

  it("ignores a corrupt stored value and falls back to system", () => {
    localStorage.setItem(THEME_KEY, "purple");
    expect(loadTheme()).toBe("system");
  });

  it("cycles system -> light -> dark -> system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});
