"use client";

import { Component, type ReactNode } from "react";

// A minimal render error boundary — the repo has none and pulls in no dependency for one
// (ponytail rung 2 checked: nothing exists to reuse; rung 7: the smallest class that works).
// It exists so a NON-ESSENTIAL surface (the past-chats history menu, fed by a query that can
// exceed Convex's 1s limit under memory pressure and THROW inside render) can fail on its own
// without taking the whole cockpit page — and chat + workspace — down with it. The error is
// LOGGED, never swallowed silently. Once tripped it stays on the fallback for the session; a
// page refresh remounts and retries (the query is a nicety, so no retry button is warranted).
export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[cockpit] ${this.props.label ?? "boundary"} failed — degrading:`, error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
