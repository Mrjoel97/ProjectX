"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/** Native Next search parameters also track router navigation and browser history. */
export function WorkspaceRoute({
  onChange,
}: {
  onChange: (params: URLSearchParams, initial: boolean) => void;
}) {
  const query = useSearchParams().toString();
  const initial = useRef(true);
  useEffect(() => {
    onChange(new URLSearchParams(query), initial.current);
    initial.current = false;
  }, [query, onChange]);
  return null;
}
