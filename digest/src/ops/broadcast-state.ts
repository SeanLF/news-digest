import type { Sql } from "../store/db.js";

export const ACCEPTED_BROADCAST_STATES: ReadonlySet<string> = new Set(["queued", "sending", "sent"]);
export const CLAIMED = "claimed ";

export interface SendRow {
  date: string;
  runId: number;
  id: string | null;
  status: string;
  recipients: number | null;
  token: string | null;
  claimedAt: string | null;
}

export function sendRow(db: Sql, date: string): Promise<SendRow | undefined> {
  return db.one<SendRow>(
    'SELECT issue_date AS date, run_id AS "runId", resend_id AS id, status, recipients, claim_token AS token, claimed_at AS "claimedAt" FROM sends WHERE issue_date=$1',
    [date],
  );
}

export const claimText = (row: Pick<SendRow, "claimedAt" | "token">): string =>
  `${CLAIMED}${row.claimedAt ?? "?"} ${row.token ?? "?"}`;

export async function broadcastState(
  db: Sql,
  runId: number,
  issueDate?: string,
): Promise<{ date: string; id: string | null; status: string | null } | null> {
  const run =
    issueDate === undefined
      ? await db.one<{ date: string }>("SELECT (started_at AT TIME ZONE 'UTC')::date AS date FROM runs WHERE id = $1", [
          runId,
        ])
      : { date: issueDate };
  const row = run && (await sendRow(db, run.date));
  if (!row) return null;
  return { date: row.date, id: row.id, status: row.status === "claimed" ? claimText(row) : row.status };
}

export async function clearClaim(db: Sql, date: string): Promise<boolean> {
  return (
    (await db.run("DELETE FROM sends WHERE issue_date=$1 AND resend_id IS NULL AND status='claimed'", [date])) === 1
  );
}
export const clearClaimCommand = (date: string): string => `node dist/cli/clear-claim.js ${date}`;
