import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Wire Convex Auth sign-in/callback httpAction routes.
auth.addHttpRoutes(http);

export default http;
