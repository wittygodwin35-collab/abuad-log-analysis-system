import { afterEach, describe, expect, it } from "vitest";
import { getAuthSecret, getConfiguredCredentials, isValidCredentialAttempt } from "@/lib/auth";

const originalUsername = process.env.APP_USERNAME;
const originalPassword = process.env.APP_PASSWORD;
const originalAuthSecret = process.env.AUTH_SECRET;
const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

afterEach(() => {
  if (originalUsername === undefined) {
    delete process.env.APP_USERNAME;
  } else {
    process.env.APP_USERNAME = originalUsername;
  }

  if (originalPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalPassword;
  }

  if (originalAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = originalAuthSecret;
  }

  if (originalNextAuthSecret === undefined) {
    delete process.env.NEXTAUTH_SECRET;
  } else {
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
  }
});

describe("dashboard credentials", () => {
  it("uses the requested defaults when credentials are not configured", () => {
    delete process.env.APP_USERNAME;
    delete process.env.APP_PASSWORD;

    expect(getConfiguredCredentials()).toEqual({
      username: "Aka-babatunde Abdulbasit Ayobamidele",
      password: "22/SCI01/025",
    });
  });

  it("matches usernames case-insensitively", () => {
    process.env.APP_USERNAME = "Aka-babatunde Abdulbasit Ayobamidele";
    process.env.APP_PASSWORD = "22/SCI01/025";

    expect(isValidCredentialAttempt("aka-babatunde abdulbasit ayobamidele", "22/SCI01/025")).toBe(
      true,
    );
    expect(isValidCredentialAttempt("AKA-BABATUNDE ABDULBASIT AYOBAMIDELE", "22/SCI01/025")).toBe(
      true,
    );
  });

  it("keeps password matching case-sensitive and exact", () => {
    process.env.APP_USERNAME = "Aka-babatunde Abdulbasit Ayobamidele";
    process.env.APP_PASSWORD = "22/SCI01/025";

    expect(isValidCredentialAttempt("Aka-babatunde Abdulbasit Ayobamidele", "22/sci01/025")).toBe(
      false,
    );
  });

  it("accepts NEXTAUTH_SECRET when AUTH_SECRET is not configured", () => {
    delete process.env.AUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "nextauth-secret";

    expect(getAuthSecret()).toBe("nextauth-secret");
  });
});
