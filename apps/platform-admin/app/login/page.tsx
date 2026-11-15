"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../../lib/control-plane-api";
import { ControlPlaneRequestError } from "../../lib/control-plane-browser-transport";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await login({ username: String(form.get("username") ?? ""), password: String(form.get("password") ?? "") });
      router.replace("/operations");
    } catch (error) {
      setError(error instanceof ControlPlaneRequestError && [401, 403, 422].includes(error.status)
        ? "Sign-in failed. Check your operator credentials."
        : "Sign-in is temporarily unavailable.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-form" onSubmit={submit}>
        <p className="eyebrow">NoteVerse</p>
        <h1>Platform control</h1>
        <label>Operator username<input name="username" required autoComplete="username" /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</button>
      </form>
    </main>
  );
}
