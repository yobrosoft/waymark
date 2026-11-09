"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAccount } from "@/lib/account";

export function AccountGate({
  warning,
  onToken,
}: {
  warning: string | null;
  onToken: (token: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the account a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createAccount(trimmed);
      await onToken(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The account was not created.");
    } finally {
      setBusy(false);
    }
  }

  async function open(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste the account token.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onToken(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That token did not open an account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-6 py-12">
      <div>
        <p className="font-heading text-3xl">Waymark</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Trips in this account can be updated by an agent and opened here, including from a shared link.
        </p>
      </div>
      {warning ? <p className="text-sm text-destructive">{warning}</p> : null}
      <form className="grid gap-3 rounded-2xl border bg-card p-4" onSubmit={(event) => void create(event)}>
        <label className="grid gap-1 text-sm">
          New account
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" />
        </label>
        <Button type="submit" disabled={busy}>
          Create account
        </Button>
      </form>
      <form className="grid gap-3 rounded-2xl border bg-card p-4" onSubmit={(event) => void open(event)}>
        <label className="grid gap-1 text-sm">
          Account token
          <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="wm_…" autoComplete="off" spellCheck={false} />
        </label>
        <Button type="submit" variant="outline" disabled={busy}>
          Open account
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </main>
  );
}
