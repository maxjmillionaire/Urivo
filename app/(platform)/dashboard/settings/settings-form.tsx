"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toast } from "../../_ui/toast";

const inputClass =
  "w-full rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20";

const secondaryBtn =
  "u-lift rounded-xl border border-hair bg-panel px-5 py-2.5 text-sm font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2 disabled:opacity-60";

/* --------------------------------- profile -------------------------------- */

export function ProfileForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== initialName.trim() && name.trim().length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name.trim() }),
      });
      if (!res.ok) throw new Error();
      toast("Profile updated", { type: "success" });
    } catch {
      toast("Couldn't save your name. Try again.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label htmlFor="set-name" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
          Display name
        </label>
        <input id="set-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={`${inputClass} max-w-sm`} />
      </div>
      <button type="submit" disabled={!dirty || busy} className={secondaryBtn}>
        {busy ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

/* ------------------------------- email change ----------------------------- */

export function EmailForm({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.toLowerCase() !== currentEmail.toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ email });
      if (error) throw error;
      setEmail("");
      toast("Confirm the change from the link we just emailed you.", { type: "success" });
    } catch {
      toast("Couldn't start the email change. Try again.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-mist">
        Current: <span className="font-medium text-ivory">{currentEmail}</span>
      </p>
      <div>
        <label htmlFor="set-email" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
          New email
        </label>
        <input id="set-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={`${inputClass} max-w-sm`} />
      </div>
      <button type="submit" disabled={!valid || busy} className={secondaryBtn}>
        {busy ? "Sending…" : "Change email"}
      </button>
    </form>
  );
}

/* ---------------------------- notifications ------------------------------- */

export function NotificationsForm({ initialOptIn }: { initialOptIn: boolean }) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setOptIn(next);
    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketingOptIn: next }),
      });
      if (!res.ok) throw new Error();
      toast(next ? "You're subscribed to product updates" : "Unsubscribed from product updates", { type: "success" });
    } catch {
      setOptIn(!next); // revert
      toast("Couldn't save that preference. Try again.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-ivory">Product &amp; launch updates</p>
        <p className="mt-1 text-xs leading-relaxed text-mist">
          Occasional emails about new features and your launch. Receipts and account emails are always sent.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optIn}
        aria-label="Product and launch update emails"
        disabled={busy}
        onClick={() => toggle(!optIn)}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${optIn ? "bg-gold" : "bg-white/[0.12]"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-night transition-transform ${optIn ? "translate-x-[22px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

/* -------------------------------- password -------------------------------- */

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const valid = useMemo(
    () => password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password),
    [password],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setMsg("8+ characters with uppercase, lowercase and a number.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      toast("Password updated", { type: "success" });
    } catch {
      toast("Could not update the password. Try again.", { type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="set-pw" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
          New password
        </label>
        <input id="set-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} max-w-sm`} />
      </div>
      {msg && <p className="text-sm text-alert">{msg}</p>}
      <button type="submit" disabled={busy} className={secondaryBtn}>
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}

/* ------------------------------ delete account ---------------------------- */

export function DeleteAccount() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
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
      toast(err instanceof Error ? err.message : "Could not delete your account.", { type: "error" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-mist">
        This permanently deletes your account, all your stores, products and credit history. This cannot be undone. Type{" "}
        <strong className="font-semibold text-ivory">DELETE</strong> to confirm.
      </p>
      <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" className={`${inputClass} max-w-xs`} />
      <button
        type="button"
        disabled={confirm !== "DELETE" || busy}
        onClick={remove}
        className="u-lift block rounded-xl border border-alert/40 bg-alert/[0.04] px-5 py-2.5 text-sm font-semibold text-alert hover:bg-alert/10 disabled:opacity-40"
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
    </div>
  );
}
