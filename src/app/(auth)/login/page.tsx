"use client";

import { useState } from "react";
import { signInAction, signUpAction } from "./actions";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  async function handle(action: (data: FormData) => Promise<{ error: string }>, data: FormData) {
    const result = await action(data);
    setError(result.error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <form className="flex flex-col gap-4" noValidate>
        <input
          name="email"
          type="email"
          placeholder="Correo electrónico"
          aria-label="Correo electrónico"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Contraseña"
          aria-label="Contraseña"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          formAction={(data) => handle(signInAction, data)}
          className="rounded bg-black px-3 py-2 text-white"
        >
          Entrar
        </button>
        <button
          type="submit"
          formAction={(data) => handle(signUpAction, data)}
          className="rounded border px-3 py-2"
        >
          Crear cuenta
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </main>
  );
}
