"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { track } from "@/lib/analytics";
import logo from "@/assets/brand/urivo-logo.png";

type Mode = "signin" | "signup" | "reset";

function passwordChecks(password: string) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
  };
}

const inputClass =
  "w-full rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeState, setCodeState] = useState<{
    status: "idle" | "checking" | "invalid" | "inactive" | "valid";
    creatorName?: string;
  }>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<{ kind: "error" | "success"; text: string } | null>(
    searchParams.get("error") === "auth"
      ? { kind: "error", text: "Sign-in link was invalid or expired. Please try again." }
      : null,
  );

  const checks = useMemo(() => passwordChecks(password), [password]);
  const passwordValid = Object.values(checks).every(Boolean);

  // Real-time creator-code validation (debounced). Optional field — a bad code
  // never blocks signup; it simply won't attribute.
  useEffect(() => {
    if (mode !== "signup") return;
    const c = code.trim();
    if (!c) {
      setCodeState({ status: "idle" });
      return;
    }
    setCodeState({ status: "checking" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/referral/validate?code=${encodeURIComponent(c)}`);
        const data = (await res.json()) as { status: string; creatorName?: string };
        const status =
          data.status === "valid" || data.status === "invalid" || data.status === "inactive"
            ? data.status
            : "idle";
        setCodeState({ status, creatorName: data.creatorName });
      } catch {
        setCodeState({ status: "idle" });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [code, mode]);

  async function handleGoogle() {
    setBanner(null);
    setPending(true);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      setBanner({ kind: "error", text: "Google sign-in is not available right now. Please use email and password." });
      setPending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setPending(true);
    try {
      const supabase = supabaseBrowser();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
        });
        if (error) throw error;
        setBanner({ kind: "success", text: "Check your inbox — we sent you a secure reset link." });
        return;
      }
      if (mode === "signup") {
        const fullName = name.trim();
        if (!fullName) {
          setBanner({ kind: "error", text: "Please enter your name so we can personalize your workspace." });
          return;
        }
        if (!passwordValid) {
          setBanner({ kind: "error", text: "Your password does not meet the requirements yet." });
          return;
        }
        // Signup guardrails: per-IP throttle + disposable-domain block (2.2).
        const guard = await fetch("/api/auth/signup-guard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.toLowerCase().trim() }),
        });
        if (!guard.ok) {
          const g = (await guard.json().catch(() => ({}))) as { message?: string };
          setBanner({
            kind: "error",
            text: g.message || "We couldn't process that signup right now. Please try again.",
          });
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.toLowerCase().trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              full_name: fullName,
              // Carried into auth metadata; the server attributes it to the
              // creator on first dashboard load (validated, first-touch).
              ...(code.trim() ? { referral_code: code.trim().toUpperCase() } : {}),
            },
          },
        });
        if (error) throw error;
        track("sign_up", { method: "email" });
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        setBanner({
          kind: "success",
          text: "Account created. Confirm your email to activate your account and unlock your welcome credits.",
        });
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });
      if (error) throw error;
      track("sign_in", { method: "email" });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setBanner({
        kind: "error",
        text:
          err instanceof Error && err.message === "Invalid login credentials"
            ? "Email or password is incorrect."
            : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  const headline =
    mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Welcome to Urivo";
  const sub =
    mode === "signup"
      ? "Start building your commerce with AI."
      : mode === "reset"
        ? "We'll email you a secure link."
        : "Sign in to your workspace.";

  return (
    <main className="relative flex min-h-[100svh] items-start justify-center overflow-x-hidden bg-night px-6 pb-16 pt-12 text-ivory sm:items-center sm:py-16">
      {/* ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 8%, rgba(232,205,128,0.10), rgba(11,18,32,0) 55%), radial-gradient(80% 60% at 50% 120%, rgba(36,50,76,0.5), rgba(11,18,32,0) 60%)",
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="flex flex-col items-center text-center">
          {/* One glow per screen — the primary action (Sign in) carries it, not
              the logo. A quiet mark reads as more confident than a lit one. */}
          <Image
            src={logo}
            alt="Urivo"
            width={72}
            height={72}
            priority
            className="rounded-[20px] u-float"
          />
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.4em] text-mist" style={{ paddingLeft: "0.4em" }}>
            Urivo
          </p>
          <h1 className="mt-6 text-[26px] font-semibold tracking-tight text-ivory">{headline}</h1>
          <p className="mt-1.5 text-sm text-mist">{sub}</p>
        </div>

        {/* Card */}
        <div className="u-float u-glass mt-8 rounded-2xl border border-hair p-7">
          {banner && (
            <p
              role="alert"
              className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
                banner.kind === "error"
                  ? "border-alert/20 bg-alert/5 text-alert"
                  : "border-live/20 bg-live/5 text-live"
              }`}
            >
              {banner.text}
            </p>
          )}

          {mode !== "reset" && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={pending}
                className="u-lift flex w-full items-center justify-center gap-3 rounded-xl border border-hair bg-panel px-4 py-3 text-sm font-medium text-ivory hover:border-hair-strong hover:bg-panel-2 disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#EA4335" d="M12 5.04c1.62 0 3.06.56 4.2 1.64l3.12-3.12C17.4 1.8 14.94.75 12 .75 7.55.75 3.72 3.3 1.84 7.02l3.66 2.84C6.4 7.13 8.98 5.04 12 5.04z" />
                  <path fill="#4285F4" d="M23.25 12.27c0-.93-.08-1.6-.26-2.3H12v4.35h6.44c-.13 1.08-.83 2.7-2.39 3.79l3.57 2.77c2.09-1.93 3.63-4.79 3.63-8.61z" />
                  <path fill="#FBBC05" d="M5.5 14.14a6.9 6.9 0 0 1-.38-2.14c0-.75.14-1.47.37-2.14L1.84 7.02A11.24 11.24 0 0 0 .75 12c0 1.8.43 3.5 1.09 4.98l3.66-2.84z" />
                  <path fill="#34A853" d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.57-2.77c-.95.66-2.23 1.12-3.89 1.12-3.02 0-5.6-2.09-6.5-4.74l-3.66 2.84c1.87 3.72 5.71 6.27 10.16 6.27z" />
                </svg>
                Continue with Google
              </button>

              <div className="mt-6 flex items-center gap-4" aria-hidden="true">
                <span className="h-px flex-1 bg-hair" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-mist-dim">or</span>
                <span className="h-px flex-1 bg-hair" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {mode === "signup" && (
              <div>
                <label htmlFor="name" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                  Your name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="Max Basner"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@company.com"
              />
            </div>

            {mode !== "reset" && (
              <div>
                <label htmlFor="password" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••••••"
                />
                {mode === "signup" && password.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                    {([["length", "8+ characters"], ["upper", "One uppercase"], ["lower", "One lowercase"], ["number", "One number"]] as const).map(
                      ([key, label]) => (
                        <li key={key} className={checks[key] ? "text-live" : "text-mist-dim"}>
                          {checks[key] ? "✓" : "○"} {label}
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            )}

            {mode === "signup" && (
              <div>
                <label
                  htmlFor="code"
                  className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-mist"
                >
                  <span>Creator code</span>
                  <span className="font-normal normal-case tracking-normal text-mist-dim">Optional</span>
                </label>
                <input
                  id="code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={24}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className={inputClass}
                  placeholder="e.g. MAX10"
                  aria-describedby="code-status"
                />
                {code.trim() && codeState.status !== "idle" && (
                  <p
                    id="code-status"
                    role="status"
                    className={`mt-2 text-xs ${
                      codeState.status === "valid"
                        ? "text-live"
                        : codeState.status === "checking"
                          ? "text-mist-dim"
                          : "text-alert"
                    }`}
                  >
                    {codeState.status === "checking" && "Checking…"}
                    {codeState.status === "valid" &&
                      `✓ ${codeState.creatorName ? `${codeState.creatorName}'s code applied` : "Code applied"}`}
                    {codeState.status === "invalid" && "We couldn't find that code — you can still continue."}
                    {codeState.status === "inactive" && "This code is no longer active — you can still continue."}
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="u-gold u-lift w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60"
            >
              {pending ? "One moment…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-6 space-y-3 text-center text-sm text-mist">
          {mode === "signin" && (
            <>
              <p>
                <button type="button" onClick={() => setMode("reset")} className="text-mist underline-offset-4 transition-colors hover:text-ivory hover:underline active:opacity-70">
                  Forgot password?
                </button>
              </p>
              <p>
                New to Urivo?{" "}
                <button type="button" onClick={() => setMode("signup")} className="font-semibold text-gold-soft underline-offset-4 transition-opacity hover:underline active:opacity-70">
                  Create account
                </button>
              </p>
            </>
          )}
          {mode !== "signin" && (
            <p>
              Already have an account?{" "}
              <button type="button" onClick={() => setMode("signin")} className="font-semibold text-gold-soft underline-offset-4 transition-opacity hover:underline active:opacity-70">
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
