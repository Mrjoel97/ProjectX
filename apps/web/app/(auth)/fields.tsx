"use client";

import { type ReactNode, useId, useState } from "react";
import { EyeIcon, EyeOffIcon } from "./icons";

// A labelled input with a leading icon. `id` links label↔input for accessibility.
export function TextField({
  label,
  icon,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  icon: ReactNode;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-input-wrap">
        <span className="auth-input-ic">{icon}</span>
        <input
          id={id}
          className="auth-input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
        />
      </div>
    </div>
  );
}

// Password input with a show/hide eye toggle (its own accessible label).
export function PasswordField({
  label,
  icon,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}
      </label>
      <div className="auth-input-wrap">
        <span className="auth-input-ic">{icon}</span>
        <input
          id={id}
          className="auth-input"
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
