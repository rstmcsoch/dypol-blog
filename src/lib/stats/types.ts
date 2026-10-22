import type { Grain, Preset } from "./range";

export type ArticleDay = { day: string; views: number; engagedViews: number; engagedMs: number };

export type ArticleStat = {
  id: string;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  publishedDay: string | null;
  categorySlug: string;
  categoryLabel: string;
  topics: { slug: string; label: string }[];
  tags: { slug: string; label: string }[];
  /** Approximate word count from stored text size, not a live recount. */
  words: number;
  minutes: number;
  lengthApproximate: true;
  lifetimeViews: number;
  views: number;
  prevViews: number;
  engagedViews: number;
  prevEngagedViews: number;
  engagedMs: number;
  prevEngagedMs: number;
  scroll25: number;
  scroll50: number;
  scroll75: number;
  scroll90: number;
  scrollEnd: number;
  internalClicks: number;
  recircViews: number;
  inboundInternal: number;
  buckets: number[];
  days: ArticleDay[];
  /** Views on the publication calendar day (Asia/Kolkata). Not an exact 24-hour window. */
  viewsFirstDay: number | null;
  viewsFirst7: number | null;
  viewsFirst28: number | null;
  first7Complete: boolean;
  first28Complete: boolean;
};

export type DimRow = { key: string; label: string; views: number; engagedViews: number; engagedMs: number };

export type StatsPayload = {
  generatedAt: string;
  fromCache: boolean;
  lastEventAt: string | null;
  timezone: "Asia/Kolkata";
  range: { preset: Preset; from: string; to: string; label: string; days: number; grain: Grain };
  previous: { from: string; to: string; label: string };
  lifetimeViews: number;
  publishedTotal: number;
  otherViews: number;
  prevOtherViews: number;
  otherDays: { day: string; views: number }[];
  channels: DimRow[];
  prevChannels: DimRow[];
  channelDays: { day: string; channel: string; views: number; engagedViews: number; engagedMs: number }[];
  devices: DimRow[];
  browsers: { key: string; label: string; views: number }[];
  operatingSystems: { key: string; label: string; views: number }[];
  countries: DimRow[];
  regions: { country: string; countryLabel: string; region: string; views: number }[];
  referrers: { host: string; views: number }[];
  campaigns: { source: string; medium: string; campaign: string; views: number }[];
  articles: ArticleStat[];
  categories: { slug: string; label: string }[];
  tags: { slug: string; label: string }[];
  sources: {
    ga4MeasurementId: string;
    ga4Reporting: "not_connected";
    searchConsole: "not_connected";
    webVitals: "not_available";
    sessions: "not_measured";
    uniqueUsers: "not_measured";
  };
};

export type ArticleSort =
  | "views"
  | "engagement"
  | "reading"
  | "completion"
  | "growth"
  | "declining"
  | "newest"
  | "recirc";

export type AgeFilter = "any" | "7" | "28" | "90" | "older90";

export type ArticleQuery = {
  q: string;
  category: string;
  tag: string;
  age: AgeFilter;
  sort: ArticleSort;
  today: string;
};
