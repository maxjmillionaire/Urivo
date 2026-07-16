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
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-105 text-center">
        <h1 className="font-serif text-3xl font-normal tracking-tight text-ivory-100">
          Choose a new password
        </h1>
        <p className="mt-2 text-sm font-light text-ivory-100/60">
          8+ characters with uppercase, lowercase and a number.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-danger-dark/30 bg-danger-dark/10 px-4 py-3 text-sm text-danger-dark"
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5 text-left">
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60"
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
              className="w-full rounded-lg border border-ivory-100/15 bg-ivory-100/5 px-4 py-3.5 text-sm font-light text-ivory-100 focus:border-gold-500 focus:bg-ivory-100/10 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gold-500 px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne disabled:translate-y-0 disabled:opacity-60"
          >
            {pending ? "One moment…" : "Save password"}
          </button>
        </form>
      </div>
    </main>
  );
}
