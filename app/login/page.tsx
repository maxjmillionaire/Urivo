"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(
    searchParams.get("error") === "auth"
      ? { kind: "error", text: "Sign-in link was invalid or expired. Please try again." }
      : null,
  );

  const checks = useMemo(() => passwordChecks(password), [password]);
  const passwordValid = Object.values(checks).every(Boolean);

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
      setBanner({
        kind: "error",
        text: "Google sign-in is not available right now. Please use email and password.",
      });
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
        setBanner({
          kind: "success",
          text: "Check your inbox — we sent you a secure reset link.",
        });
        return;
      }

      if (mode === "signup") {
        if (!passwordValid) {
          setBanner({
            kind: "error",
            text: "Your password does not meet the requirements yet.",
          });
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.toLowerCase().trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        setBanner({
          kind: "success",
          text: "Account created. Please confirm your email to continue.",
        });
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });
      if (error) throw error;
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
    mode === "signup"
      ? "Create your account"
      : mode === "reset"
        ? "Reset your password"
        : "Welcome to Urivo";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16 text-ink">
      <div className="w-full max-w-105">
        <div className="flex flex-col items-center text-center">
          <Image
            src={logo}
            alt="Urivo"
            width={56}
            height={56}
            priority
            className="rounded-xl shadow-soft"
          />
          <h1 className="mt-8 text-3xl font-semibold tracking-tight text-ink">
            {headline}
          </h1>
          <p className="mt-2 text-sm text-muted">
            Build your AI commerce business.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-line bg-surface p-7 shadow-soft sm:p-8">
          {banner && (
            <p
              role="alert"
              className={`mb-6 rounded-md border px-4 py-3 text-sm ${
                banner.kind === "error"
                  ? "border-error/20 bg-error/5 text-error"
                  : "border-success/20 bg-success/5 text-[#15803d]"
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
                className="flex w-full items-center justify-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors duration-200 hover:bg-surface-muted disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M12 5.04c1.62 0 3.06.56 4.2 1.64l3.12-3.12C17.4 1.8 14.94.75 12 .75 7.55.75 3.72 3.3 1.84 7.02l3.66 2.84C6.4 7.13 8.98 5.04 12 5.04z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.25 12.27c0-.93-.08-1.6-.26-2.3H12v4.35h6.44c-.13 1.08-.83 2.7-2.39 3.79l3.57 2.77c2.09-1.93 3.63-4.79 3.63-8.61z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.5 14.14a6.9 6.9 0 0 1-.38-2.14c0-.75.14-1.47.37-2.14L1.84 7.02A11.24 11.24 0 0 0 .75 12c0 1.8.43 3.5 1.09 4.98l3.66-2.84z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23.25c3.04 0 5.6-1 7.46-2.72l-3.57-2.77c-.95.66-2.23 1.12-3.89 1.12-3.02 0-5.6-2.09-6.5-4.74l-3.66 2.84c1.87 3.72 5.71 6.27 10.16 6.27z"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="mt-6 flex items-center gap-4" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  or
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/15"
                placeholder="you@company.com"
              />
            </div>

            {mode !== "reset" && (
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/15"
                  placeholder="••••••••••••"
                />
                {mode === "signup" && password.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                    {(
                      [
                        ["length", "8+ characters"],
                        ["upper", "One uppercase"],
                        ["lower", "One lowercase"],
                        ["number", "One number"],
                      ] as const
                    ).map(([key, label]) => (
                      <li
                        key={key}
                        className={
                          checks[key] ? "text-[#15803d]" : "text-muted"
                        }
                      >
                        {checks[key] ? "✓" : "○"} {label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover disabled:translate-y-0 disabled:opacity-60"
            >
              {pending
                ? "One moment…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-6 space-y-3 text-center text-sm text-muted">
          {mode === "signin" && (
            <>
              <p>
                <button
                  type="button"
                  onClick={() => setMode("reset")}
                  className="text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
                >
                  Forgot password?
                </button>
              </p>
              <p>
                New to Urivo?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="font-semibold text-brand underline-offset-4 hover:underline"
                >
                  Create account
                </button>
              </p>
            </>
          )}
          {mode !== "signin" && (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="font-semibold text-brand underline-offset-4 hover:underline"
              >
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
