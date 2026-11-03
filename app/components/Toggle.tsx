"use client";

// Shared on/off switch. Green when on. Used for ASAP, and Auto-charge.
// A switch, not a checkbox and not a dropdown: the track slides and the word says On or Off.
import { useId } from "react";

export default function Toggle({ on, onChange, label, hint, disabled, testId, title, tone, size }: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** Visible name, also the accessible name. */
  label: string;
  /** Extra line, for example why the switch cannot be turned on. */
  hint?: string;
  disabled?: boolean;
  testId?: string;
  title?: string;
  /** "danger": the switch turns red when on (INOP). */
  tone?: "danger";
  /** "sm": compact switch for per-vehicle rows (several vehicles on one screen). */
  size?: "sm";
}) {
  const hintId = useId();
  // Compact chip (vehicle flags: ASAP / INOP / ENC-OPEN / EXPEDITED). Owner 2026-10-31:
  // no sliding track; a small pill that is filled when on, so several fit on one or two rows.
  if (size === "sm") {
    return (
      <button type="button" role="switch" aria-checked={on} aria-label={`${label}, ${on ? "on" : "off"}`} disabled={disabled} data-testid={testId} title={title}
        className={`flag-chip${on ? " on" : ""}${tone === "danger" ? " danger" : ""}`} onClick={() => { if (!disabled) onChange(!on); }}>
        {label}
      </button>
    );
  }
  return (
    <div className={`toggle${on ? " on" : ""}${disabled ? " disabled" : ""}${tone === "danger" ? " toggle-danger" : ""}${size === "sm" ? " toggle-sm" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}, ${on ? "on" : "off"}`}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        data-testid={testId}
        title={title}
        className="toggle-hit"
        onClick={() => { if (!disabled) onChange(!on); }}
      >
        <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
        <span className="toggle-word">{on ? "On" : "Off"}</span>
        <span className="toggle-label">{label}</span>
      </button>
      {hint ? <span className="toggle-hint" id={hintId} data-testid={testId ? `${testId}-hint` : undefined}>{hint}</span> : null}
    </div>
  );
}
