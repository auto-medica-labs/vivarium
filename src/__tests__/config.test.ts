import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { getEnvInt, getEnvString, getEnvBool } from "../utils";

describe("getEnvInt", () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
  });

  afterEach(() => {
    process.env = OLD;
  });

  test("returns default when variable is not set", () => {
    delete process.env.TEST_INT;
    expect(getEnvInt("TEST_INT", 42)).toBe(42);
  });

  test("returns default when variable is empty string", () => {
    process.env.TEST_INT = "";
    expect(getEnvInt("TEST_INT", 99)).toBe(99);
  });

  test("parses valid integer", () => {
    process.env.TEST_INT = "15";
    expect(getEnvInt("TEST_INT", 0)).toBe(15);
  });

  test("parses zero", () => {
    process.env.TEST_INT = "0";
    expect(getEnvInt("TEST_INT", 10)).toBe(0);
  });

  test("throws on non-integer value", () => {
    process.env.TEST_INT = "abc";
    expect(() => getEnvInt("TEST_INT", 0)).toThrow(
      "must be a non-negative integer",
    );
  });

  test("throws on negative value", () => {
    process.env.TEST_INT = "-5";
    expect(() => getEnvInt("TEST_INT", 0)).toThrow(
      "must be a non-negative integer",
    );
  });

  test("truncates float via parseInt", () => {
    process.env.TEST_INT = "3.14";
    expect(getEnvInt("TEST_INT", 0)).toBe(3);
  });
});

describe("getEnvString", () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
  });

  afterEach(() => {
    process.env = OLD;
  });

  test("returns default when not set", () => {
    delete process.env.TEST_STR;
    expect(getEnvString("TEST_STR", "fallback")).toBe("fallback");
  });

  test("returns value when set", () => {
    process.env.TEST_STR = "hello";
    expect(getEnvString("TEST_STR", "nope")).toBe("hello");
  });

  test("returns empty string value when explicitly set", () => {
    process.env.TEST_STR = "";
    expect(getEnvString("TEST_STR", "fallback")).toBe("fallback");
  });
});

describe("getEnvBool", () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
  });

  afterEach(() => {
    process.env = OLD;
  });

  test("returns default when not set", () => {
    delete process.env.TEST_BOOL;
    expect(getEnvBool("TEST_BOOL", false)).toBe(false);
    expect(getEnvBool("TEST_BOOL", true)).toBe(true);
  });

  test('"1" is truthy', () => {
    process.env.TEST_BOOL = "1";
    expect(getEnvBool("TEST_BOOL", false)).toBe(true);
  });

  test('"true" is truthy', () => {
    process.env.TEST_BOOL = "true";
    expect(getEnvBool("TEST_BOOL", false)).toBe(true);
  });

  test('"0" is falsy', () => {
    process.env.TEST_BOOL = "0";
    expect(getEnvBool("TEST_BOOL", true)).toBe(false);
  });

  test('"false" is falsy', () => {
    process.env.TEST_BOOL = "false";
    expect(getEnvBool("TEST_BOOL", true)).toBe(false);
  });
});
