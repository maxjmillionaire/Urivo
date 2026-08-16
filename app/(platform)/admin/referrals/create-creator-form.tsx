"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Admin-only creator onboarding. Posts to /api/admin/creators (itself
 * admin-gated) and refreshes the dashboard on success.
 */
export function CreateCreatorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, email: email || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.message ?? "Could not create creator." });
      } else {
        setMsg({ ok: true, text: `Created ${data.creator.name} · code ${data.creator.code}` });
        setName("");
        setCode("");
        setEmail("");
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <Field label="Creator name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Max Mustermann"
          className="w-48 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-amber-300/50"
        />
      </Field>
      <Field label="Code">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
          minLength={3}
          maxLength={24}
          placeholder="MAX10"
          className="w-32 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm uppercase tracking-wide text-white placeholder-white/30 outline-none focus:border-amber-300/50"
        />
      </Field>
      <Field label="Email (optional)">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          maxLength={200}
          placeholder="max@example.com"
          className="w-56 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-amber-300/50"
        />
      </Field>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Add creator"}
      </button>
      {msg && (
        <p className={`w-full text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-white/45">{label}</span>
      {children}
    </label>
  );
}
