import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

// Public surface: the marketing/legal pages and the sign-in page itself. Everything
// else (the `(app)` route group, /connect-gmail added in 02-08/09) is gated.
// Default-deny: a new route is private until it is added here — the safe direction.
// /api/media/render is server-to-server (Convex renderReel → this deployment): it has no auth
// cookie by construction and does its own fail-closed bearer check (`handleRenderRequest` 401s
// on a missing/wrong MEDIA_RENDER_SECRET before any sandbox exists). Without this exemption the
// cookie redirect 307s the POST to /signin and every prod render dead-letters route_unreachable.
const isPublic = createRouteMatcher([
  "/",
  "/privacy",
  "/terms",
  "/signin",
  "/signup",
  "/api/media/render",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (!isPublic(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  // Run on everything except Next internals and static files (with an extension).
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
