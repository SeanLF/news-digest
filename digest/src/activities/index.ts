import type { AlertRequest } from "../ops/alerts.js";
import type { Pointer } from "../store/artifacts.js";
export type { AlertRequest };

export interface DigestInput {
  runDate: string;
  resumeRun?: number;
  force?: boolean;
  failStage?: "select";
}
export interface ExtractBatch {
  index: number;
  ids: string[];
}
export interface StoryPlan {
  index: number;
  tier: "must_know" | "should_know";
  storyIds: string[];
  contextIds: string[];
  clusterIndex?: number;
}
export type FulltextTask = [articleId: string, url: string];
export interface FulltextFetch {
  tasks: number;
  results: Record<string, string>;
  outcome: string;
}
export interface FulltextPlan {
  tasks: FulltextTask[];
  existing?: Pointer;
  skip?: "disabled" | "no_candidates";
}
export interface FulltextFetcher {
  fetchFulltext(tasks: FulltextTask[]): Promise<FulltextFetch>;
}
export interface GnewsDecode {
  links: number;
  decoded: Record<string, string>;
  attempted: number;
  outcome: string;
}
export interface GnewsPlan {
  urls: string[];
  existing?: Pointer;
  skip?: "disabled" | "no_candidates";
}
export interface LinkDecoder {
  decodeLinks(urls: string[]): Promise<GnewsDecode>;
}
export interface ThreadPlan {
  threadId: number;
  articleIds: string[];
}
export interface ThreadsLinked {
  plans: ThreadPlan[];
  skip?: "disabled";
}
export interface ThreadOutcome {
  threadId: number;
  auditFailed: boolean;
}
export interface ThreadsReport {
  linkError?: string;
  timedOut?: boolean;
  outcomes: ThreadOutcome[];
  failures: { threadId: number; error: string }[];
}
export interface FetchSummary {
  sourceId: string;
  ok: boolean;
  fetched: number;
  kept: number;
  error?: string;
}
export interface DigestOutput {
  runId: number;
  stories: number;
  broadcast: "sent" | "disabled" | "rejected" | "skipped" | "held-out";
  recipients?: number;
}

export interface Activities extends LinkDecoder {
  startRun(input: DigestInput): Promise<{ runId: number; sourceIds: string[]; lastRun: string | null }>;
  fetchFeed(runId: number, sourceId: string, lastRun: string | null): Promise<FetchSummary>;
  prepare(runId: number, fetched: FetchSummary[], force?: boolean): Promise<{ articles: Pointer[]; index: Pointer }>;
  planBatches(runId: number, articles: Pointer[]): Promise<{ batches: ExtractBatch[] }>;
  extractBatch(runId: number, batch: ExtractBatch, force?: boolean): Promise<Pointer>;
  joinClusters(runId: number, tagBatches: (Pointer | null)[], force?: boolean): Promise<Pointer>;
  recap(runId: number, force?: boolean): Promise<Pointer>;
  select(runId: number, clusters: Pointer, recap: Pointer, note?: string, input?: DigestInput): Promise<Pointer>;
  planFulltext(runId: number, selected: Pointer, force?: boolean): Promise<FulltextPlan>;
  storeFulltext(runId: number, fetched: FulltextFetch, force?: boolean): Promise<Pointer>;
  planFulltextTopup(runId: number, drafts: Pointer[], force?: boolean): Promise<FulltextPlan>;
  storeFulltextTopup(runId: number, fetched: FulltextFetch, force?: boolean): Promise<Pointer>;
  planStories(runId: number, selected: Pointer, clusters: Pointer): Promise<{ plans: StoryPlan[] }>;
  writeStory(runId: number, plan: StoryPlan, selected: Pointer, note?: string, force?: boolean): Promise<Pointer>;
  preheader(runId: number, drafts: Pointer[], force?: boolean): Promise<Pointer>;
  coherence(runId: number, drafts: Pointer[], fulltext: Pointer, note?: string, force?: boolean): Promise<Pointer>;
  repair(runId: number, drafts: Pointer[], report: Pointer, force?: boolean): Promise<Pointer>;
  attribute(runId: number, drafts: Pointer[], report: Pointer, repair: Pointer, force?: boolean): Promise<Pointer>;
  assemble(
    runId: number,
    drafts: Pointer[],
    report: Pointer,
    repair: Pointer,
    preheader: Pointer | null,
    attribution: Pointer | null,
    force?: boolean,
  ): Promise<Pointer>;
  planGnews(runId: number, selections: Pointer, force?: boolean): Promise<GnewsPlan>;
  storeGnews(runId: number, decoded: GnewsDecode, force?: boolean): Promise<Pointer>;
  threadsLink(runId: number, force?: boolean): Promise<ThreadsLinked>;
  threadSynthesis(runId: number, plan: ThreadPlan): Promise<ThreadOutcome>;
  threadsFinish(runId: number, report: ThreadsReport): Promise<Pointer>;
  threadsRetract(runId: number): Promise<{ retracted: boolean; reason?: string }>;
  render(
    runId: number,
    selections: Pointer,
    threads: Pointer,
    gnews: Pointer,
  ): Promise<{ html: Pointer; email: Pointer }>;
  archiveRun(runId: number, selections: Pointer, clusters: Pointer): Promise<void>;
  sendEnabled(): Promise<boolean>;
  checkPreSend(runId: number): Promise<string[]>;
  notifyHold(runId: number, selections: Pointer, holdEndsAt: string, failures: string[]): Promise<{ sent: boolean }>;
  saveDigest(runId: number, html: Pointer, selections: Pointer): Promise<{ date: string }>;
  broadcast(runId: number, email: Pointer): Promise<{ broadcastId: string; status: string; recipients: number }>;
  recordShownHeadlines(runId: number, selections: Pointer): Promise<{ rows: number }>;
  finishRun(runId: number, output: Omit<DigestOutput, "runId">): Promise<void>;
  weeklyRecap(runId: number, force?: boolean): Promise<Pointer | null>;
  healthcheck(event: "start" | "success" | "fail", note?: string): Promise<void>;
  healthcheckLog(message: string): Promise<void>;
  checkFeeds(runId: number, sourceIds: string[]): Promise<AlertRequest | null>;
  checkRunHealth(runId: number, broadcasting: boolean): Promise<AlertRequest | null>;
  alert(req: AlertRequest): Promise<void>;
  abortRun(runId: number, error: string): Promise<void>;
}
export const STORY_COUNT_STUB = 3;
export const THREAD_CONTEXT = "thread_context.json";
export const DECODED_LINKS = "gnews_links.json";
