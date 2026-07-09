export default {
  providers: [
    {
      // Convex Auth uses the deployment's own site URL as the issuer.
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
