"use client";

import { useEffect, useState, type FormEvent } from "react";
import { GoogleSignIn } from "@/components/google-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAccount, signInWithGoogle } from "@/lib/account";
import { loadGoogleClientID } from "@/lib/google";

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
  const [clientID, setClientID] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void loadGoogleClientID().then((id) => {
      if (!cancel) setClientID(id);
    });
    return () => {
      cancel = true;
    };
  }, []);

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

  async function google(credential: string) {
    setBusy(true);
    setError(null);
    try {
      await onToken(await signInWithGoogle(credential));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in did not open an account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-6 py-12">
      <div>
        <p className="font-heading text-3xl">Waymark</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientID
            ? "Sign in with Google. The first sign-in creates the account an agent can update."
            : "Trips in this account can be updated by an agent and opened here, including from a shared link."}
        </p>
      </div>
      {warning ? <p className="text-sm text-destructive">{warning}</p> : null}
      {clientID === null ? <p className="text-sm text-muted-foreground">Loading sign-in…</p> : null}
      {clientID ? (
        <div className="grid gap-3 rounded-2xl border bg-card p-4">
          <GoogleSignIn clientID={clientID} onCredential={(credential) => void google(credential)} onError={setError} />
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Use an existing account token</summary>
            <form className="mt-3 grid gap-3" onSubmit={(event) => void open(event)}>
              <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="wm_…" autoComplete="off" spellCheck={false} />
              <Button type="submit" variant="outline" disabled={busy}>
                Open account
              </Button>
            </form>
          </details>
        </div>
      ) : null}
      {clientID === "" ? (
        <>
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
        </>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </main>
  );
}
