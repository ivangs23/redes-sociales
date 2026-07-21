import { afterEach, describe, expect, it } from "vitest";
import { getRequiredEnv } from "./env";

const KEY = "TEST_ONLY_VARIABLE";

afterEach(() => {
  delete process.env[KEY];
});

describe("getRequiredEnv", () => {
  it("returns the value when the variable is set", () => {
    process.env[KEY] = "hello";
    expect(getRequiredEnv(KEY)).toBe("hello");
  });

  it("throws naming the variable when it is missing", () => {
    expect(() => getRequiredEnv(KEY)).toThrow(KEY);
  });

  it("throws when the variable is an empty string", () => {
    process.env[KEY] = "";
    expect(() => getRequiredEnv(KEY)).toThrow(KEY);
  });
});
