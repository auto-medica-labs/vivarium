import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter.stop();
  });

  test("allows requests within the limit", () => {
    limiter = new RateLimiter(5);
    for (let i = 0; i < 5; i++) {
      const result = limiter.isAllowed("1.2.3.4");
      expect(result.allowed).toBe(true);
      expect(result.retryAfter).toBeUndefined();
    }
  });

  test("blocks requests that exceed the limit", () => {
    limiter = new RateLimiter(3);
    for (let i = 0; i < 3; i++) {
      expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
    }
    const blocked = limiter.isAllowed("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  test("different IPs have independent counters", () => {
    limiter = new RateLimiter(2);
    expect(limiter.isAllowed("1.1.1.1").allowed).toBe(true);
    expect(limiter.isAllowed("1.1.1.1").allowed).toBe(true);
    expect(limiter.isAllowed("1.1.1.1").allowed).toBe(false);

    expect(limiter.isAllowed("2.2.2.2").allowed).toBe(true);
    expect(limiter.isAllowed("2.2.2.2").allowed).toBe(true);
    expect(limiter.isAllowed("2.2.2.2").allowed).toBe(false);
  });

  test("reset clears all counters", () => {
    limiter = new RateLimiter(2);
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(false);

    limiter.reset();
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
  });

  test("stop clears the cleanup interval", () => {
    limiter = new RateLimiter(5);
    limiter.stop();
    // No crash after stop
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
  });

  test("limit of 0 blocks every request", () => {
    limiter = new RateLimiter(0);
    const result = limiter.isAllowed("1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("single IP can be rate limited then recover after reset", () => {
    limiter = new RateLimiter(1);
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(false);
    limiter.reset();
    expect(limiter.isAllowed("1.2.3.4").allowed).toBe(true);
  });
});
