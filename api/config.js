export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    providers: {
      auth: process.env.AUTH_PROVIDER || "Clerk",
      database: process.env.DATABASE_PROVIDER || "Neon",
      kyc: process.env.KYC_PROVIDER || "Veriff",
      payments: process.env.PAYMENTS_PROVIDER || "Circle",
      wallet: process.env.WALLET_PROVIDER || "Circle",
      monitoring: process.env.MONITORING_PROVIDER || "Sentry",
    },
    public: {
      clerk_publishable_key: process.env.CLERK_PUBLISHABLE_KEY || "",
      sentry_dsn: process.env.SENTRY_DSN || process.env.MONITORING_DSN || "",
    },
  });
}
