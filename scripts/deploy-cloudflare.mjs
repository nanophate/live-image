import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (mode !== "private" && mode !== "password" && mode !== "review") {
  console.error("Usage: node scripts/deploy-cloudflare.mjs <private|password|review>");
  process.exit(2);
}

if (mode === "review" && !process.argv.includes("--confirm-public-review")) {
  console.error("Public review requires --confirm-public-review.");
  process.exit(2);
}

const vars = [
  "HOSTED_COMPILER_ENABLED:true",
  mode === "private" ? "REQUIRE_ACCESS_JWT:true" : "REQUIRE_ACCESS_JWT:false",
  `AUTH_MODE:${mode === "private" ? "access" : mode === "password" ? "shared-password" : "public-review"}`,
];

if (mode === "private") {
  vars.push("PUBLIC_REVIEW_NOT_BEFORE:", "PUBLIC_REVIEW_EXPIRES_AT:");
  console.log("Deploying private mode. Origin JWT verification remains required.");
  console.log("If returning from public review, enable this mode before re-enabling Cloudflare Access.");
} else if (mode === "password") {
  vars.push("PUBLIC_REVIEW_NOT_BEFORE:", "PUBLIC_REVIEW_EXPIRES_AT:");
  console.log("Deploying shared-password review mode.");
  console.log("REVIEW_PASSWORD and REVIEW_SESSION_SECRET must already exist as Worker secrets.");
  console.log("Keep Access enabled and test the Worker gate from an Access-authenticated browser after clearing only the review cookie.");
  console.log("Disable Access last, then immediately repeat the matrix from a truly signed-out browser.");
} else {
  const notBefore = new Date();
  const expiresAt = new Date(notBefore.getTime() + 2 * 60 * 60 * 1000);
  vars.push(
    `PUBLIC_REVIEW_NOT_BEFORE:${notBefore.toISOString()}`,
    `PUBLIC_REVIEW_EXPIRES_AT:${expiresAt.toISOString()}`,
  );
  console.log(`Deploying public-review origin mode until ${expiresAt.toISOString()}.`);
  console.log("Cloudflare Access still protects the hostname after this deploy.");
  console.log("Disabling Access opens the entire workers.dev origin, not only /compiler.html.");
  console.log("Disable the Access application only after this command succeeds; re-enable private mode when judging ends.");
}

const args = [
  "deploy",
  "--containers-rollout=none",
  "--keep-vars",
  "--message",
  mode === "private"
    ? "Deploy Access-protected Compiler and Viewer"
    : mode === "password"
      ? "Deploy shared-password Compiler and Viewer"
      : "Deploy two-hour unauthenticated review window",
];
if (dryRun) args.push("--dry-run");
for (const variable of vars) args.push("--var", variable);

const result = spawnSync("wrangler", args, {
  stdio: "inherit",
  env: { ...process.env, WRANGLER_WRITE_LOGS: "0" },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
