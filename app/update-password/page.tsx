"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import logo from "@/assets/brand/urivo-logo.png";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-night px-6 py-16 text-ivory">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(60% 45% at 50% 8%, rgba(232,205,128,0.10), rgba(11,18,32,0) 55%)" }}
      />
      <div className="relative w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center">
          <Image src={logo} alt="Urivo" width={64} height={64} priority className="rounded-[18px] u-float" />
          <h1 className="mt-6 text-[26px] font-semibold tracking-tight text-ivory">Choose a new password</h1>
          <p className="mt-1.5 text-sm text-mist">8+ characters with uppercase, lowercase and a number.</p>
        </div>

        <div className="u-float u-glass mt-8 rounded-2xl border border-hair p-7">
          {error && (
            <p role="alert" className="mb-6 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
              {error}
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20"
              />
            </div>
            <button type="submit" disabled={pending} className="u-gold u-lift w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60">
              {pending ? "One moment…" : "Save password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
