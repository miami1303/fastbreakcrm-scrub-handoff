"use client";

import { formatPhoneEdit } from "@/lib/phone-format";

/** Controlled phone input. Digits format as 303-555-1234; a leading 1 is stripped. */
export default function PhoneNumberInput({ name, value, onChange, required, ariaLabel }: {
  name?: string; value: string; onChange: (v: string) => void; required?: boolean; ariaLabel?: string;
}) {
  return (
    <input
      name={name}
      value={value}
      required={required}
      aria-label={ariaLabel}
      inputMode="tel"
      autoComplete="tel"
      maxLength={40}
      onChange={e => {
        const el = e.target;
        const { value: next, caret } = formatPhoneEdit(el.value, el.selectionStart ?? el.value.length);
        if (el.value !== next) el.value = next;
        onChange(next);
        requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      }}
    />
  );
}
