import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Public surface: the marketing/legal pages and the sign-in page itself. Everything
// else (the `(app)` route group, /connect-gmail added in 02-08/09) is gated.
// Default-deny: a new route is private until it is added here — the safe direction.
const isPublic = createRouteMatcher(["/", "/privacy", "/terms", "/signin", "/signup"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (!isPublic(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // Run on everything except Next internals and static files (with an extension).
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
