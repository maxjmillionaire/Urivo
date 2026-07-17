"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(
    () =>
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password),
    [password],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("Password needs 8+ characters with uppercase, lowercase and a number.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const supabase = supabaseBrowser();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Could not update the password. Request a new reset link and try again.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16 text-ink">
      <div className="w-full max-w-105">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Choose a new password
          </h1>
          <p className="mt-2 text-sm text-muted">
            8+ characters with uppercase, lowercase and a number.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-line bg-surface p-7 shadow-soft sm:p-8">
          {error && (
            <p
              role="alert"
              className="mb-6 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
            >
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted"
              >
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/15"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover disabled:translate-y-0 disabled:opacity-60"
            >
              {pending ? "One moment…" : "Save password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
