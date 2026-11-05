export interface IndexMeta {
  total: number;
  firstDate: string | null;
  newestDate: string | null;
  totalStories: number;
}

export interface IssueRowData {
  date: string;
  preheader: string;
  issueNo: number;
  must: number;
  should: number;
  isMonthStart: boolean;
  sourceIds: string[];
}

export interface SearchHit {
  headline: string;
  tier: string;
  date: string | null;
}

export interface ThreadSummaryData {
  id: number;
  label: string;
  status: string;
  updatedAt: string;
  updateCount: number;
  latestContent: string | null;
}

export interface ThreadIndexData {
  ongoing: ThreadSummaryData[];
  older: ThreadSummaryData[];
  olderTotal: number;
}

export interface ThreadData {
  label: string;
  status: string;
  installments: { day: string; issueDate: string | null; story: string; content: string | null }[];
  openQuestions: { question: string; raisedContent: string | null }[];
}

export interface StatsData {
  sourceHealth: { sourceId: string; total: number; successes: number }[];
  sourceUsage: { sourceId: string; tier: string; count: number }[];
  recentRuns: { runAt: string; articlesKept: number; recipients: number; apiCostUsd: number | null }[];
  dedup: { count: number; avg: number | null; min: number | null; max: number | null };
  neverSelected: string[];
  cost: { runs: number; keptTotal: number; costTotal: number; shippedTotal: number; recipientsLatest: number };
}

export interface SiteData {
  indexMeta(): Promise<IndexMeta>;
  archive(q: { before?: string | undefined; year?: number | undefined; limit: number }): Promise<IssueRowData[]>;
  issue(date: string): Promise<{ html: string; preheader: string; markdown: string | null } | undefined>;
  latestIssueDate(): Promise<string | undefined>;
  feed(limit: number): Promise<{ date: string; preheader: string }[]>;
  search(query: string, limit: number): Promise<SearchHit[]>;
  threadIndex(before: { updatedAt: string; id: number } | undefined, limit: number): Promise<ThreadIndexData>;
  mergedInto(id: number): Promise<number | null | undefined>;
  thread(id: number): Promise<ThreadData | undefined>;
  stats(days: number, now: Date): Promise<StatsData>;
  ping(): Promise<void>;
}
