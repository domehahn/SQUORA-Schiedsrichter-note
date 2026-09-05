import { describe, expect, it, vi } from "vitest";
import { applyUpdate, setApplyUpdate } from "./swUpdate";

describe("swUpdate", () => {
  it("calls whatever apply function was registered", () => {
    const fn = vi.fn();
    setApplyUpdate(fn);
    applyUpdate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does nothing (does not throw) before an apply function is registered", () => {
    setApplyUpdate(null as unknown as () => void);
    expect(() => applyUpdate()).not.toThrow();
  });
});
