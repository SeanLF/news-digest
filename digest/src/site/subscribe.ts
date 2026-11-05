import { createHmac, timingSafeEqual } from "node:crypto";
import mailchecker from "mailchecker";
import type { Resend } from "resend";
import { log } from "../log.js";
import type { SiteConfig } from "./config.js";

export const CONFIRM_TTL_S = 48 * 60 * 60;

export const isValidEmail = (email: string): boolean => mailchecker.isValid(email.trim());

const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
const sign = (secret: string, payload: string): Buffer => createHmac("sha256", secret).update(payload).digest();

export const makeToken = (secret: string, email: string, expUnix: number): string => {
  const payload = `${email}\n${expUnix}`;
  return `${b64(payload)}.${b64(sign(secret, payload))}`;
};

export function verifyToken(secret: string, token: string, nowUnix: number): string | undefined {
  const [p, s, extra] = token.split(".");
  if (p === undefined || s === undefined || extra !== undefined) return undefined;
  if (!/^[A-Za-z0-9_-]*$/.test(p) || !/^[A-Za-z0-9_-]*$/.test(s)) return undefined;
  const payload = Buffer.from(p, "base64url");
  const sig = Buffer.from(s, "base64url");
  const want = createHmac("sha256", secret).update(payload).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return undefined;
  }
  const nl = text.indexOf("\n");
  if (nl < 0) return undefined;
  const exp = text.slice(nl + 1);
  if (!/^\d+$/.test(exp) || Number(exp) <= nowUnix) return undefined;
  return text.slice(0, nl);
}

export const confirmationHtml = (
  digestName: string,
  confirmUrl: string,
): string => `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
  <h1 style="font-size:20px;margin:0 0 12px;">Confirm your subscription</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#444;">Tap the button to confirm you want the ${digestName} morning briefing in your inbox.</p>
  <p style="margin:0 0 24px;"><a href="${confirmUrl}" style="display:inline-block;background:#c45a3b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:600;">Confirm subscription</a></p>
  <p style="font-size:13px;line-height:1.5;color:#888;margin:0;">If you didn't request this, just ignore this email — you won't be subscribed.</p>
</div>`;

export const confirmationText = (digestName: string, confirmUrl: string): string =>
  `Confirm your subscription\n\nConfirm you want the ${digestName} morning briefing in your inbox by opening this link:\n${confirmUrl}\n\nIf you didn't request this, just ignore this email — you won't be subscribed.\n`;

export type Mail = { contacts: Pick<Resend["contacts"], "create">; emails: Pick<Resend["emails"], "send"> };

async function checked(
  what: string,
  call: Promise<{ error: { name: string; statusCode: number | null } | null }>,
): Promise<boolean> {
  try {
    const { error } = await call;
    if (error) {
      log.error({ site: "subscribe", error: `Resend ${what} failed`, kind: error.name, status: error.statusCode });
      return false;
    }
    return true;
  } catch (e) {
    log.error({
      site: "subscribe",
      error: `Resend ${what} request failed`,
      kind: e instanceof Error ? e.name : "unknown",
    });
    return false;
  }
}

export const addContact = (cfg: SiteConfig, mail: Mail, email: string): Promise<boolean> =>
  checked("contacts", mail.contacts.create({ audienceId: cfg.resendAudienceId!, email }));

export function sendConfirmation(cfg: SiteConfig, mail: Mail, email: string, confirmUrl: string): Promise<boolean> {
  return checked(
    "email",
    mail.emails.send({
      from: `${cfg.digestName} <${cfg.fromEmail!}>`,
      to: [email],
      subject: `Confirm your subscription to ${cfg.digestName}`,
      html: confirmationHtml(cfg.digestName, confirmUrl),
      text: confirmationText(cfg.digestName, confirmUrl),
      ...(cfg.contactEmail ? { replyTo: cfg.contactEmail } : {}),
    }),
  );
}
