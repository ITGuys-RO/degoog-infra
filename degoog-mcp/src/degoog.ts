const DEFAULT_URL = process.env.DEGOOG_URL ?? "http://degoog.local:4444";
const DEFAULT_LANG = process.env.DEGOOG_DEFAULT_LANGUAGE ?? "ro";
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.DEGOOG_TIMEOUT_MS ?? "15000",
  10,
);

export const TIME_FILTERS = [
  "any",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;
export type TimeFilter = (typeof TIME_FILTERS)[number];

export const SEARCH_TYPES = ["web", "images", "videos", "news"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  thumbnail?: string;
  duration?: string;
}

interface DegoogResponse {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    source?: string;
    thumbnail?: string;
    duration?: string;
  }>;
  error?: string;
}

export interface SearchOptions {
  query: string;
  page?: number;
  language?: string;
  timeFilter?: TimeFilter;
  searchType?: SearchType;
}

export async function search(opts: SearchOptions): Promise<SearchResult[]> {
  const query = opts.query?.trim();
  if (!query) throw new Error("query is required");

  const page = Math.max(1, Math.min(10, Math.floor(opts.page ?? 1)));
  const language = opts.language ?? DEFAULT_LANG;
  const timeFilter = opts.timeFilter ?? "any";
  const searchType = opts.searchType ?? "web";

  const params = new URLSearchParams({
    q: query,
    page: String(page),
    time: timeFilter,
    lang: language,
  });
  // Degoog returns 0 results when type=web is passed explicitly, but defaults
  // to web server-side when omitted, so only send the param for non-web types.
  if (searchType !== "web") params.set("type", searchType);

  const url = `${DEFAULT_URL.replace(/\/+$/, "")}/api/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`degoog ${resp.status}: ${await resp.text().catch(() => "")}`);
  }

  const data = (await resp.json()) as DegoogResponse;
  if (data.error) throw new Error(`degoog: ${data.error}`);

  return (data.results ?? []).map((r) => {
    const item: SearchResult = {
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.snippet ?? "",
      source: r.source ?? "",
    };
    if (r.thumbnail) item.thumbnail = r.thumbnail;
    if (r.duration) item.duration = r.duration;
    return item;
  });
}
