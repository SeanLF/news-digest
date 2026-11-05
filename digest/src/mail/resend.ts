import { Resend, type Response as ResendReply } from "resend";
import { resendBaseUrl } from "../resend/destination.js";

export const RESEND_TIMEOUT_MS = 30_000;

class BoundedResend extends Resend {
  constructor(
    key: string,
    baseUrl: string,
    private readonly bounds: { timeoutMs: number; signal?: () => AbortSignal | undefined },
  ) {
    super(key, { baseUrl });
  }
  override fetchRequest<T>(path: string, options: RequestInit = {}): Promise<ResendReply<T>> {
    const outer = this.bounds.signal?.();
    const signal = AbortSignal.any([AbortSignal.timeout(this.bounds.timeoutMs), ...(outer ? [outer] : [])]);
    return super.fetchRequest<T>(path, { ...options, signal });
  }
}
export const resendClient = (
  apiKey: string,
  bounds: { timeoutMs?: number; signal?: () => AbortSignal | undefined } = {},
  env: Record<string, string | undefined> = process.env,
): Resend =>
  new BoundedResend(apiKey, resendBaseUrl(env), {
    timeoutMs: bounds.timeoutMs ?? RESEND_TIMEOUT_MS,
    ...(bounds.signal ? { signal: bounds.signal } : {}),
  });

export interface Email {
  from: string;
  to: string[];
  subject: string;
  html: string;
}
export type SendEmail = (email: Email, opts?: { idempotencyKey?: string }) => Promise<{ id: string }>;
export type ResendEmails = Pick<Resend["emails"], "send">;

export class ResendSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = "ResendSendError";
  }
}

export function emailSender(emails: ResendEmails): SendEmail {
  return async (email, opts) => {
    const { data, error } = await emails.send(
      email,
      opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
    if (error)
      throw new ResendSendError(
        `${error.name} (${error.statusCode ?? "no status"}): ${error.message}`,
        error.statusCode,
      );
    return { id: data.id };
  };
}
