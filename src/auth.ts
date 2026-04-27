import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Cloudflare Access JWT verification.
 *
 * When this Worker is placed behind a Cloudflare Zero Trust Access
 * application, every incoming request is signed by Access with a JWT
 * delivered in the `Cf-Access-Jwt-Assertion` request header (and as a
 * `CF_Authorization` cookie on browser requests).
 *
 * See: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 *
 * Verification is enabled only when both `CF_ACCESS_TEAM_DOMAIN` and
 * `CF_ACCESS_POLICY_AUD` are configured. If either is missing (e.g. local
 * dev where the app isn't fronted by Access) verification is skipped.
 */

export interface AccessAuthEnv {
  /** e.g. "https://<team-name>.cloudflareaccess.com" */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag from the Access app */
  CF_ACCESS_POLICY_AUD?: string;
}

// Cache the JWKS per team domain across requests within the same isolate.
const jwksCache = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function getJWKS(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`),
    );
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

function forbidden(message: string): Response {
  return new Response(message, {
    status: 403,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Verify the Cloudflare Access JWT on an incoming request.
 *
 * Returns:
 *   - `null` if verification is not configured (skip) or the token is valid.
 *   - a 403 `Response` if the token is missing or invalid (caller should return it).
 */
export async function verifyAccessJwt(
  request: Request,
  env: AccessAuthEnv,
): Promise<Response | null> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_POLICY_AUD;

  // If not configured, skip verification (e.g. local development).
  if (!teamDomain || !aud) return null;

  // Prefer the header; the cookie is not guaranteed to be forwarded.
  let token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    const cookie = request.headers.get("cookie");
    if (cookie) {
      const match = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
      if (match) token = decodeURIComponent(match[1]);
    }
  }

  if (!token) {
    return forbidden("Missing required CF Access JWT");
  }

  try {
    const JWKS = getJWKS(teamDomain);
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: teamDomain.replace(/\/$/, ""),
      audience: aud,
    });
    // Attach the verified payload for downstream consumers if needed.
    (request as Request & { accessPayload?: JWTPayload }).accessPayload =
      payload;
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return forbidden(`Invalid CF Access JWT: ${message}`);
  }
}
