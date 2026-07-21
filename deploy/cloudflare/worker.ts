import { Container, getContainer } from "@cloudflare/containers";

import {
  forwardedHeaders,
  hostedCompilerPolicy,
  json,
  requireAccessAssertion,
  uploadLength,
  validateCompileRequest,
} from "./request-policy.js";

function policy(env: Env) {
  return hostedCompilerPolicy({
    accessAudience: env.ACCESS_POLICY_AUD,
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN,
    compilerEnabled: env.HOSTED_COMPILER_ENABLED,
    publicReviewExpiresAt: env.PUBLIC_REVIEW_EXPIRES_AT,
    publicReviewNotBefore: env.PUBLIC_REVIEW_NOT_BEFORE,
    requireAccessJwt: env.REQUIRE_ACCESS_JWT,
  });
}

export class CompilerContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  pingEndpoint = "ping";
  sleepAfter = "5m";
  enableInternet = false;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/config") {
      const compilerPolicy = policy(env);
      return json(200, {
        compiler: "hosted",
        enabled: compilerPolicy.enabled,
        authentication: compilerPolicy.authenticationRequired ? "cloudflare-access" : "none",
        reviewExpiresAt: compilerPolicy.authenticationRequired ? undefined : env.PUBLIC_REVIEW_EXPIRES_AT,
        samplesAvailable: false,
        provider: "cloudflare",
      });
    }
    if (url.pathname !== "/api/compile") {
      return url.pathname.startsWith("/api/")
        ? json(404, { status: "error", message: "Unknown compiler endpoint" })
        : env.ASSETS.fetch(request);
    }

    const requestId = crypto.randomUUID();
    const compilerPolicy = policy(env);
    if (!compilerPolicy.enabled) {
      return json(
        503,
        { status: "error", message: "Hosted compilation is not enabled for this deployment" },
        requestId,
      );
    }
    if (compilerPolicy.authenticationRequired) {
      const unauthorized = await requireAccessAssertion(
        request,
        {
          audience: env.ACCESS_POLICY_AUD,
          teamDomain: env.ACCESS_TEAM_DOMAIN,
        },
        requestId,
      );
      if (unauthorized) return unauthorized;
    }
    const invalid = validateCompileRequest(request, requestId, compilerPolicy.requireExactOrigin);
    if (invalid) return invalid;

    if (!request.body) {
      return json(400, { status: "error", message: "The selected image is empty" }, requestId);
    }
    const length = uploadLength(request);
    const fixedBody = new FixedLengthStream(length);
    const bodyTransfer = request.body.pipeTo(fixedBody.writable);
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders(request, requestId),
      body: fixedBody.readable,
    });
    const compiler = getContainer(env.COMPILER, "primary");
    const [response] = await Promise.all([compiler.fetch(forwarded), bodyTransfer]);
    return response;
  },
} satisfies ExportedHandler<Env>;
