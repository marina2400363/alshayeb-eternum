import React from "react";

// Underline-style field: large type, hairline rule, accent on focus. Label is
// always visible (never placeholder-only) and errors are announced.
export function TextField({ id, label, error, hint, prefix, className = "", inputRef, ...inputProps }) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div className={`s2-ob-field ${error ? "is-error" : ""} ${className}`}>
      <label className="s2-ob-label" htmlFor={id}>
        {label}
      </label>
      <div className="s2-ob-control">
        {prefix && (
          <span className="s2-ob-prefix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          ref={inputRef}
          className="s2-ob-input"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          {...inputProps}
        />
      </div>
      {hasMessage && (
        <p id={messageId} className={error ? "s2-ob-error" : "s2-ob-hint"} role={error ? "alert" : undefined}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

// Email address — required customer data (never a login or lookup key).
// type=email + inputMode/autoComplete bring the right keyboard (with "@") and
// the browser's saved-address autofill on phones. Capitalisation, correction
// and spell-check are off: an address is not prose, and a phone keyboard must
// not capitalise the first letter or "fix" it. Normalisation (trim +
// lowercase) happens on Continue and again on submit.
export function EmailField({ id = "email", label = "Email", ...props }) {
  return (
    <TextField
      id={id}
      label={label}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      maxLength={254}
      placeholder="name@example.com"
      {...props}
    />
  );
}

// Egyptian mobile number. "+20" is a fixed visual prefix (the backend is
// Egypt-only); customers may still type 01…, 1… or paste +20…, and the value
// is normalized before it is sent.
export function PhoneField({ id = "phone", label = "Mobile number", ...props }) {
  return (
    <TextField
      id={id}
      label={label}
      prefix="+20"
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      placeholder="010 1234 5678"
      maxLength={20}
      spellCheck={false}
      {...props}
    />
  );
}
