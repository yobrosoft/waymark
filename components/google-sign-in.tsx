"use client";

import { useEffect, useRef } from "react";

type CredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (response: CredentialResponse) => void; auto_select?: boolean }) => void;
          renderButton: (parent: HTMLElement, options: { theme: string; size: string; text: string; shape: string; width: number }) => void;
        };
      };
    };
  }
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const found = document.querySelector<HTMLScriptElement>("script[data-waymark-google]");
  if (found) {
    return new Promise((resolve, reject) => {
      found.addEventListener("load", () => resolve(), { once: true });
      found.addEventListener("error", () => reject(new Error("Google sign-in did not load.")), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.waymarkGoogle = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in did not load."));
    document.head.appendChild(script);
  });
}

export function GoogleSignIn({
  clientID,
  onCredential,
  onError,
}: {
  clientID: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        await loadScript();
        if (cancel || !host.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientID,
          auto_select: false,
          callback: (response) => {
            if (response.credential) onCredentialRef.current(response.credential);
            else onError("Google sign-in did not complete.");
          },
        });
        host.current.replaceChildren();
        window.google.accounts.id.renderButton(host.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: Math.max(240, Math.min(320, host.current.clientWidth || 320)),
        });
      } catch (err) {
        if (!cancel) onError(err instanceof Error ? err.message : "Google sign-in did not load.");
      }
    })();
    return () => {
      cancel = true;
    };
  }, [clientID, onError]);

  return <div ref={host} className="flex min-h-10 justify-center" />;
}
