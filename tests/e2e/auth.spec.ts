import { expect, test } from "@playwright/test";

test("an anonymous visitor is sent to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("a new user signs up and lands on their own org", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("test-password-1234");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("org-name")).toHaveText(email.split("@")[0] as string);
});

test("a malformed email shows an error and stays on login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("nope");
  await page.getByLabel("Contraseña").fill("test-password-1234");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page.getByTestId("form-error")).toHaveText(
    "Introduce un correo electrónico válido.",
  );
  await expect(page).toHaveURL(/\/login$/);
});
