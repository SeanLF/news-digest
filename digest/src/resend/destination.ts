export const RESEND_API_URL = "https://api.resend.com";

export class MailDestinationError extends Error {
  override name = "MailDestinationError";
}

export function resendBaseUrl(env: Record<string, string | undefined>): string {
  const base = env["RESEND_BASE_URL"]?.trim() || undefined;
  if (env["RESEND_LIVE"] === "true") {
    if (base)
      throw new MailDestinationError(
        `RESEND_LIVE=true but RESEND_BASE_URL is set (${base}): production would mail a stand-in; unset one of them`,
      );
    return RESEND_API_URL;
  }
  if (!base) {
    throw new MailDestinationError(
      "RESEND_BASE_URL is unset and RESEND_LIVE is not true: refusing to reach real Resend; point RESEND_BASE_URL at a fake (the dev stack runs resend-fake), or set RESEND_LIVE=true in production",
    );
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new MailDestinationError(`RESEND_BASE_URL is not a URL: ${base}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new MailDestinationError(`RESEND_BASE_URL is not a URL: ${base}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "resend.com" || host.endsWith(".resend.com"))
    throw new MailDestinationError(`RESEND_BASE_URL names Resend itself (${host}) and RESEND_LIVE is not true`);
  return base.replace(/\/+$/, "");
}
