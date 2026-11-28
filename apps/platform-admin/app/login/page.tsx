"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  MfaChallengeRead,
  MfaEnrollmentRead,
  TotpEnrollmentRead,
} from "../../generated/api/types.gen";
import {
  login,
  startMfaEnrollment,
  confirmMfaEnrollment,
  verifyMfa,
} from "../../lib/control-plane-api";
import {
  isUnauthorized,
  requestErrorMessage,
  ControlPlaneApplicationError,
} from "../../lib/control-plane-browser-transport";
import { useAdminSession } from "../../components/admin-session";
import { TotpQr } from "../../components/totp-qr";

type Step =
  | { kind: "password" }
  | {
      kind: "enroll";
      challenge: MfaChallengeRead;
      enrollment: TotpEnrollmentRead | null;
    }
  | { kind: "verify"; challenge: MfaChallengeRead }
  | { kind: "recovery"; result: MfaEnrollmentRead };

export default function LoginPage() {
  const session = useAdminSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const failures = useRef(0);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (session.status === "authenticated") router.replace("/operations");
  }, [session.status, router]);
  const expiresAt =
    step.kind === "enroll" || step.kind === "verify"
      ? step.challenge.expires_at
      : null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        setStep({ kind: "password" });
        setCode("");
        setError(
          "The MFA challenge expired. Sign in with your password again.",
        );
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  async function attempt(action: () => Promise<void>, mfa = false) {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      if (!active.current) return;
      if (mfa && isUnauthorized(cause)) {
        failures.current++;
        if (
          !expiresAt ||
          Date.parse(expiresAt) <= Date.now() ||
          failures.current >= 5 ||
          (cause instanceof ControlPlaneApplicationError &&
            cause.code === "token_invalid_expired")
        ) {
          setStep({ kind: "password" });
          setCode("");
          setError(
            "The MFA challenge expired or reached its attempt limit. Sign in with your password again.",
          );
        } else
          setError(
            "The code was not accepted. Use a fresh authenticator code or an unused recovery code. You can also restart sign-in.",
          );
      } else setError(requestErrorMessage(cause));
    } finally {
      busy.current = false;
      if (active.current) setSubmitting(false);
    }
  }

  function passwordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("email") ?? "");
    const password = String(fields.get("password") ?? "");
    form.reset();
    void attempt(async () => {
      const challenge = await login({ email, password });
      if (!active.current) return;
      failures.current = 0;
      setCode("");
      setRecoveryMode(false);
      if (challenge.purpose === "ENROLLMENT_REQUIRED") {
        setStep({ kind: "enroll", challenge, enrollment: null });
        const enrollment = await startMfaEnrollment();
        if (active.current)
          setStep((current) =>
            current.kind === "enroll" ? { ...current, enrollment } : current,
          );
      } else setStep({ kind: "verify", challenge });
    });
  }

  function mfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "enroll" && step.kind !== "verify") return;
    const command = code.trim();
    if (step.kind === "enroll" && !step.enrollment) return;
    if (step.kind === "enroll" || !recoveryMode) {
      if (!/^[0-9]{6}$/.test(command)) {
        setError("Enter the six-digit authenticator code.");
        return;
      }
    } else if (!/^[a-fA-F0-9]{5}(-[a-fA-F0-9]{5}){3}$/.test(command)) {
      setError("Enter a recovery code in the format XXXXX-XXXXX-XXXXX-XXXXX.");
      return;
    }
    setCode("");
    void attempt(async () => {
      if (step.kind === "enroll") {
        const result = await confirmMfaEnrollment({ code: command });
        if (active.current) {
          setAcknowledged(false);
          setStep({ kind: "recovery", result });
        }
      } else {
        const result = await verifyMfa(
          recoveryMode ? { recovery_code: command } : { code: command },
        );
        if (active.current) {
          session.authenticate(
            result.operator,
            result.recovery_codes_remaining,
          );
          router.replace("/operations");
        }
      }
    }, true);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (active.current) setNotice("Copied to clipboard. Store it securely.");
    } catch {
      if (active.current)
        setError(
          "Copy is unavailable. Select and copy the displayed value manually.",
        );
    }
  }
  function downloadCodes() {
    if (step.kind !== "recovery") return;
    const url = URL.createObjectURL(
      new Blob([step.result.recovery_codes.join("\n") + "\n"], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "noteverse-admin-recovery-codes.txt";
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }
  function restart() {
    setStep({ kind: "password" });
    setCode("");
    setAcknowledged(false);
    setRecoveryMode(false);
    setError(null);
    setNotice(null);
    failures.current = 0;
  }

  if (session.status === "loading")
    return (
      <main className="auth-shell">
        <p role="status">Checking operator session...</p>
      </main>
    );
  if (session.status === "error")
    return (
      <main className="auth-shell">
        <div className="auth-form">
          <p role="alert">Sign-in is temporarily unavailable.</p>
          <button onClick={session.reload}>Try again</button>
        </div>
      </main>
    );
  if (session.status === "authenticated") return null;
  return (
    <main className="auth-shell">
      <section
        className={`auth-form ${step.kind === "recovery" ? "recovery-panel" : ""}`}
        aria-label="Operator sign-in"
      >
        <div>
          <p className="eyebrow">NoteVerse</p>
          <h1>Platform control</h1>
        </div>
        {step.kind === "password" && (
          <form onSubmit={passwordSubmit}>
            <p>
              Sign in with your operator email, then verify your authenticator.
            </p>
            <label>
              Operator email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                disabled={submitting}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                disabled={submitting}
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Checking password..." : "Continue"}
            </button>
          </form>
        )}
        {step.kind === "enroll" && (
          <>
            <h2>Set up your authenticator</h2>
            <p>
              Scan this code with your authenticator app, or enter the manual
              key. Keep this key private.
            </p>
            {step.enrollment ? (
              <>
                <TotpQr uri={step.enrollment.otpauth_uri} />
                <label>
                  Manual setup key
                  <input
                    readOnly
                    value={step.enrollment.secret}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void copy(step.enrollment!.secret)}
                >
                  Copy manual key
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void attempt(async () => {
                    const enrollment = await startMfaEnrollment();
                    if (active.current)
                      setStep((current) =>
                        current.kind === "enroll"
                          ? { ...current, enrollment }
                          : current,
                      );
                  }, true)
                }
              >
                Load enrollment code
              </button>
            )}
          </>
        )}
        {(step.kind === "enroll" || step.kind === "verify") && (
          <form onSubmit={mfaSubmit}>
            {step.kind === "verify" && (
              <>
                <h2>Verify your identity</h2>
                <div
                  className="segmented-control"
                  aria-label="Verification method"
                >
                  <button
                    type="button"
                    aria-pressed={!recoveryMode}
                    disabled={submitting}
                    onClick={() => {
                      setRecoveryMode(false);
                      setCode("");
                      setError(null);
                    }}
                  >
                    Authenticator app
                  </button>
                  <button
                    type="button"
                    aria-pressed={recoveryMode}
                    disabled={submitting}
                    onClick={() => {
                      setRecoveryMode(true);
                      setCode("");
                      setError(null);
                    }}
                  >
                    Recovery code
                  </button>
                </div>
              </>
            )}
            <label>
              {step.kind === "verify" && recoveryMode
                ? "One-time recovery code"
                : "Authenticator code"}
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode={
                  step.kind === "verify" && recoveryMode ? "text" : "numeric"
                }
                autoComplete="one-time-code"
                required
                maxLength={step.kind === "verify" && recoveryMode ? 23 : 6}
                disabled={submitting}
              />
            </label>
            <button
              type="submit"
              disabled={
                submitting || (step.kind === "enroll" && !step.enrollment)
              }
            >
              {submitting
                ? "Verifying..."
                : step.kind === "enroll"
                  ? "Confirm enrollment"
                  : "Verify and sign in"}
            </button>
            <p className="muted">
              This challenge expires after five minutes and allows five
              unsuccessful attempts.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={submitting}
              onClick={restart}
            >
              Restart sign-in
            </button>
          </form>
        )}
        {step.kind === "recovery" && (
          <>
            <h2>Save your recovery codes</h2>
            <p>
              These ten single-use codes appear once. Save them in a secure
              place before continuing. Leaving or reloading this page clears
              them.
            </p>
            <ul className="recovery-codes">
              {step.result.recovery_codes.map((value) => (
                <li key={value}>
                  <code>{value}</code>
                </li>
              ))}
            </ul>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copy(step.result.recovery_codes.join("\n"))}
              >
                Copy recovery codes
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={downloadCodes}
              >
                Download .txt
              </button>
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I have stored these recovery codes securely.
            </label>
            <button
              type="button"
              disabled={!acknowledged}
              onClick={() => {
                const operator = step.result.operator;
                restart();
                session.authenticate(operator);
                router.replace("/operations");
              }}
            >
              Enter console
            </button>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
