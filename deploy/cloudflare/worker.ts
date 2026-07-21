import { Container, getContainer } from "@cloudflare/containers";

import {
  forwardedHeaders,
  json,
  requireAccessAssertion,
  uploadLength,
  validateCompileRequest,
} from "./request-policy.js";

interface Env {
  ACCESS_POLICY_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ASSETS: Fetcher;
  COMPILER: DurableObjectNamespace<CompilerContainer>;
  HOSTED_COMPILER_ENABLED?: string;
}

function compilerEnabled(env: Env): boolean {
  return env.HOSTED_COMPILER_ENABLED === "true"
    && Boolean(env.ACCESS_POLICY_AUD)
    && Boolean(env.ACCESS_TEAM_DOMAIN);
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
      return json(200, {
        compiler: "hosted",
        enabled: compilerEnabled(env),
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
    if (!compilerEnabled(env)) {
      return json(
        503,
        { status: "error", message: "Hosted compilation is not enabled for this deployment" },
        requestId,
      );
    }
    const unauthorized = await requireAccessAssertion(
      request,
      {
        audience: env.ACCESS_POLICY_AUD,
        teamDomain: env.ACCESS_TEAM_DOMAIN,
      },
      requestId,
    );
    if (unauthorized) return unauthorized;
    const invalid = validateCompileRequest(request, requestId);
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
