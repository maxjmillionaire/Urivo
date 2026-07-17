"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/15";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const valid = useMemo(
    () =>
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password),
    [password],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setMsg({ kind: "error", text: "8+ characters with uppercase, lowercase and a number." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setMsg({ kind: "ok", text: "Password updated." });
    } catch {
      setMsg({ kind: "error", text: "Could not update the password. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          New password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>
      {msg && (
        <p className={`text-sm ${msg.kind === "ok" ? "text-[#15803d]" : "text-error"}`}>
          {msg.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Could not delete your account.");
      }
      router.push("/login?status=deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete your account.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        This permanently deletes your account, all your stores, products and
        credit history. This cannot be undone. Type <strong className="font-semibold text-ink">DELETE</strong> to confirm.
      </p>
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="DELETE"
        className={`${inputClass} max-w-xs`}
      />
      {error && <p className="text-sm text-error">{error}</p>}
      <button
        type="button"
        disabled={confirm !== "DELETE" || busy}
        onClick={remove}
        className="block rounded-md border border-error/40 bg-surface px-5 py-2.5 text-sm font-semibold text-error transition-colors hover:bg-error/5 disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </div>
  );
}
