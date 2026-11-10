import { describe, expect, it } from "vitest";
import { googleClientID } from "../lib/google";

describe("google client id", () => {
  it("prefers the runtime config and falls back to the build value", () => {
    expect(googleClientID({ googleClientId: " from-config " }, "from-env")).toBe("from-config");
    expect(googleClientID({ googleClientId: "" }, "from-env")).toBe("from-env");
    expect(googleClientID(null, "")).toBe("");
  });
});
