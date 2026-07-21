import { describe, expect, it } from "vitest";
import { parseCredentials } from "./credentials";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("parseCredentials", () => {
  it("accepts a valid email and password", () => {
    expect(parseCredentials(form({ email: "a@b.com", password: "longenough" }))).toEqual({
      email: "a@b.com",
      password: "longenough",
    });
  });

  it("trims and lowercases the email", () => {
    expect(parseCredentials(form({ email: "  A@B.COM ", password: "longenough" }))).toEqual({
      email: "a@b.com",
      password: "longenough",
    });
  });

  it("rejects a malformed email", () => {
    expect(parseCredentials(form({ email: "nope", password: "longenough" }))).toEqual({
      error: "Introduce un correo electrónico válido.",
    });
  });

  it("rejects a password under 8 characters", () => {
    expect(parseCredentials(form({ email: "a@b.com", password: "short" }))).toEqual({
      error: "La contraseña debe tener al menos 8 caracteres.",
    });
  });

  it("rejects a 7-character password", () => {
    expect(parseCredentials(form({ email: "a@b.com", password: "1234567" }))).toEqual({
      error: "La contraseña debe tener al menos 8 caracteres.",
    });
  });

  it("accepts an 8-character password", () => {
    expect(parseCredentials(form({ email: "a@b.com", password: "12345678" }))).toEqual({
      email: "a@b.com",
      password: "12345678",
    });
  });

  it("rejects missing fields", () => {
    expect(parseCredentials(form({}))).toEqual({
      error: "Introduce un correo electrónico válido.",
    });
  });

  it("rejects a valid email with a missing password field", () => {
    expect(parseCredentials(form({ email: "a@b.com" }))).toEqual({
      error: "La contraseña debe tener al menos 8 caracteres.",
    });
  });
});
