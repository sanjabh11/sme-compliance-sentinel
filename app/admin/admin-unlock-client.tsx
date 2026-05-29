"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export function AdminUnlockClient({ tokenConfigured }: { tokenConfigured: boolean }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to unlock the admin console.");
        return;
      }

      window.location.reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-unlock-shell">
      <section className="admin-unlock-panel" aria-label="Admin console locked">
        <div className="admin-unlock-icon" aria-hidden="true">
          <LockKeyhole size={22} />
        </div>
        <p className="eyebrow">Operator access</p>
        <h1>Admin console locked</h1>
        <p>
          Public demos keep buyer pages open and protect internal readiness, evidence, deployment, and submission
          surfaces behind an operator token.
        </p>
        {!tokenConfigured ? (
          <div className="admin-unlock-warning" role="status">
            SENTINEL_ADMIN_ACTION_TOKEN is not configured. Add it through the hosted environment before public
            lockdown can be unlocked.
          </div>
        ) : null}
        <form onSubmit={submit} className="admin-unlock-form">
          <label htmlFor="admin-token">Admin token</label>
          <input
            id="admin-token"
            name="admin-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste operator token"
          />
          {error ? <p className="admin-unlock-error">{error}</p> : null}
          <button type="submit" disabled={submitting || !token.trim() || !tokenConfigured}>
            <ShieldCheck size={18} aria-hidden="true" />
            {submitting ? "Unlocking..." : "Unlock admin console"}
          </button>
        </form>
        <Link href="/">Return to customer demo</Link>
      </section>
    </main>
  );
}
