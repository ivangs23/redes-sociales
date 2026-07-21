export type Credentials = { email: string; password: string };
export type ParseResult = Credentials | { error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCredentials(formData: FormData): ParseResult {
  const rawEmail = formData.get("email");
  const rawPassword = formData.get("password");
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Introduce un correo electrónico válido." };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }
  return { email, password };
}
