import { lazy, useMemo, useState } from "react";
import "./stats.css";
import { adminEditorialStats } from "@/content/admin-api";
import { errorText } from "@/components/admin/gate";
import {
  buildInsights,
  buildSeries,
  filterArticles,
  lengthBands,
  publishedCount,
  rankTopics,
  rate,
  readingSummary,
  sortArticles,
  tagRows,
  topicRows,
  totalsFromArticles,
} from "@/lib/stats/aggregate";
import { READ_BUCKETS } from "@/lib/stats/histogram";
import { formatCount, formatDelta, formatDuration, formatPercent, istStamp } from "@/lib/stats/format";
import { formatRangeLabel, PRESETS, type Preset, type StatsRequest } from "@/lib/stats/range";
import type { ArticleQuery, StatsPayload } from "@/lib/stats/types";
import {
  ArticleBars,
  ArticleTable,
  ChartCard,
  DataTable,
  Kpi,
  Methodology,
  Unavailable,
  publishBars,
  short,
  topReading,
  weakReading,
} from "./stats-widgets";

const TrendChart = lazy(() => import("./stats-charts").then((m) => ({ default: m.TrendChart })));
const CompareBars = lazy(() => import("./stats-charts").then((m) => ({ default: m.CompareBars })));
const DonutChart = lazy(() => import("./stats-charts").then((m) => ({ default: m.DonutChart })));
const HBarChart = lazy(() => import("./stats-charts").then((m) => ({ default: m.HBarChart })));
const HistogramChart = lazy(() => import("./stats-charts").then((m) => ({ default: m.HistogramChart })));

const SECTIONS = [
  ["overview", "Overview"],
  ["reading", "Reading"],
  ["articles", "Articles"],
  ["topics", "Topics"],
  ["sources", "Sources"],
  ["audience", "Audience"],
  ["search", "Search"],
  ["journey", "Journey"],
  ["publishing", "Publishing"],
  ["insights", "Insights"],
] as const;

type Section = (typeof SECTIONS)[number][0];

const PRESET_LABEL: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "7 days",
  "28d": "28 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
  custom: "Custom",
};

export function StatsDesk({ initial }: { initial: StatsPayload }) {
  const [payload, setPayload] = useState(initial);
  const [preset, setPreset] = useState<Preset>(initial.range.preset);
  const [from, setFrom] = useState(initial.range.from);
  const [to, setTo] = useState(initial.range.to);
  const [compare, setCompare] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState<ArticleQuery>({
    q: "",
    category: "",
    tag: "",
    age: "any",
    sort: "views",
    today: initial.range.to,
  });

  async function load(next: StatsRequest) {
    setPending(true);
    setError(null);
    try {
      const data = await adminEditorialStats({ data: next });
      setPayload(data);
      setQuery((current) => ({ ...current, today: data.range.to }));
      setPage(0);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  const filtered = useMemo(() => sortArticles(filterArticles(payload.articles, query), query.sort), [payload.articles, query]);
  const filterActive = Boolean(query.q || query.category || query.tag || query.age !== "any");
  const current = totalsFromArticles(filtered, "current");
  const previous = totalsFromArticles(filtered, "previous");
  const reading = readingSummary(current);
  const publishedNow = publishedCount(filtered, payload.range.from, payload.range.to);
  const publishedPrev = publishedCount(filtered, payload.previous.from, payload.previous.to);
  const otherMap = useMemo(() => new Map(payload.otherDays.map((row) => [row.day, row.views])), [payload.otherDays]);
  const series = buildSeries(filtered, otherMap, payload.range.from, payload.range.to, payload.range.grain);
  const prevSeries = buildSeries(filtered, new Map(), payload.previous.from, payload.previous.to, payload.range.grain);
  const topics = rankTopics(topicRows(filtered));
  const tags = tagRows(filtered);
  const insights = buildInsights({
    rangeLabel: formatRangeLabel(payload.range.from, payload.range.to),
    previousLabel: formatRangeLabel(payload.previous.from, payload.previous.to),
    periodEnd: payload.range.to,
    articles: filtered,
    channels: payload.channels,
    publishedNow,
    publishedPrev,
  });

  const trend = series.map((point, index) => ({
    label: payload.range.grain === "month" ? point.label : point.label.slice(5),
    views: point.views,
    other: filterActive ? 0 : point.otherViews,
    prev: prevSeries[index]?.views ?? 0,
  }));

  return (
    <div className={pending ? "stats is-pending" : "stats"}>
      <p className="desk-kicker">Audience</p>
      <div className="stats-head">
        <div>
          <h1 className="desk-title">Stats</h1>
          <p className="desk-note">
            {formatRangeLabel(payload.range.from, payload.range.to)} · Asia/Kolkata · {payload.range.grain === "day" ? "daily" : payload.range.grain === "week" ? "weekly chunks" : "monthly"} points
          </p>
        </div>
        <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => void load({ preset, from, to, fresh: true })}>
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="desk-note">
        Compiled {istStamp(payload.generatedAt)} IST{payload.fromCache ? " (cached, up to 10 minutes)" : ""}. Last recorded event: {istStamp(payload.lastEventAt)} IST.
        Signed-in admin browsers and detected bots are left out when the request shows it. That exclusion is not guaranteed for every device you use.
      </p>
      {error ? <p className="banner banner--bad" role="alert">{error}</p> : null}

      <div className="stats-filters" role="group" aria-label="Reporting period">
        {PRESETS.filter((item) => item !== "custom").map((item) => (
          <button
            key={item}
            type="button"
            className={preset === item ? "stats-chip is-on" : "stats-chip"}
            aria-pressed={preset === item}
            onClick={() => {
              setPreset(item);
              void load({ preset: item });
            }}
          >
            {PRESET_LABEL[item]}
          </button>
        ))}
        <button type="button" className={preset === "custom" ? "stats-chip is-on" : "stats-chip"} aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}>
          Custom
        </button>
        <label className="stats-compare">
          <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
          Compare with previous period
        </label>
      </div>
      {preset === "custom" ? (
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            void load({ preset: "custom", from, to });
          }}
        >
          <label className="field"><span>From</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required /></label>
          <label className="field"><span>To</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} required /></label>
          <button className="btn" type="submit" disabled={pending}>Apply range</button>
        </form>
      ) : null}
      <p className="desk-note">Previous equivalent period: {formatRangeLabel(payload.previous.from, payload.previous.to)}.</p>
      {filterActive ? <p className="banner">Article filters are on. Article charts follow them. Traffic sources, countries and devices stay site-wide, because those counts are not stored per topic.</p> : null}

      <div className="stats-tabs" role="tablist" aria-label="Statistics sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? "stats-tab is-on" : "stats-tab"} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === "overview" ? (
        <section className="desk-section" role="tabpanel">
          <div className="stat-grid">
            <Kpi label="Article views" hint="Published article opens counted once per browser tab session. Not unique people, and not the same number Google Analytics calls a page view." value={formatCount(current.views)} delta={compare ? formatDelta(current.views, previous.views) : null} />
            <Kpi label="Other page views" hint="Home, topic and other public pages, once per tab session per path. Not filtered by topic." value={formatCount(filterActive ? payload.otherViews : series.reduce((s, p) => s + p.otherViews, 0) || payload.otherViews)} delta={compare ? formatDelta(payload.otherViews, payload.prevOtherViews) : null} />
            <Kpi label="Recorded reads" hint="Article views that sent a reading beacon when the page was hidden. This is not a session and not a unique reader." value={formatCount(current.engagedViews)} delta={compare ? formatDelta(current.engagedViews, previous.engagedViews) : null} />
            <Kpi label="Engagement rate" hint="Recorded reads divided by article views. Views with no beacon count as not engaged." value={formatPercent(reading.engagementRate)} delta={compare ? formatDelta(reading.engagementRate ?? 0, rate(previous.engagedViews, previous.views) ?? 0) : null} />
            <Kpi label="Avg time per view" hint="Total visible time divided by all article views. Views with no beacon count as zero seconds." value={formatDuration(reading.avgPerViewMs)} delta={null} />
            <Kpi label="Avg time per recorded read" hint="Total visible time divided only by reading beacons. Short bounces that never beacon are excluded here." value={formatDuration(reading.avgPerRecordedMs)} delta={null} />
            <Kpi label="Published in period" hint="Articles whose publication date falls in this Asia/Kolkata window." value={formatCount(publishedNow)} delta={compare ? formatDelta(publishedNow, publishedPrev) : null} />
            <Kpi label="All published articles" hint="Current count of published articles. Not limited to this date range." value={formatCount(payload.publishedTotal)} delta={null} />
            <Kpi label="All-time article views" hint="The existing lifetime counter. It is not dated, so it cannot be filtered to this period and has no comparison." value={formatCount(payload.lifetimeViews)} delta={null} />
          </div>
          <Unavailable
            items={[
              ["Unique visitors", "Not measured. This meter does not store a visitor id, so it cannot count people."],
              ["Sessions, new and returning users", "Not measured. There is no session id."],
              ["Bounce rate", "Not shown. The connected page tag does not feed a bounce definition into this dashboard."],
              ["Google Analytics reporting", `The site loads GA4 ${payload.sources.ga4MeasurementId} in the browser, but no Analytics Data API property or credential is configured, so those reports are not read.`],
            ]}
          />
          <div className="stats-charts">
            <ChartCard title="Views over time" note="Article views and other public pages. The dashed line is the previous period, aligned from the first day.">
              <TrendChart data={trend} compare={compare} />
            </ChartCard>
            <ChartCard title="This period vs the previous one" note="Article views, recorded reads and articles published.">
              <CompareBars
               
                data={[
                  { label: "Views", current: current.views, previous: previous.views },
                  { label: "Reads", current: current.engagedViews, previous: previous.engagedViews },
                  { label: "Published", current: publishedNow, previous: publishedPrev },
                ]}
              />
            </ChartCard>
            <ChartCard title="Where views came from" note="Share of all measured page views in this period. “No referrer” is not proof someone typed the address.">
              <DonutChart data={payload.channels.map((row) => ({ name: row.label, value: row.views }))} />
            </ChartCard>
          </div>
          <DataTable
            title="Period table"
            headers={["Period", "Article views", "Recorded reads", "Other pages"]}
            rows={series.map((point) => [point.label, formatCount(point.views), formatCount(point.engagedViews), formatCount(point.otherViews)])}
          />
        </section>
      ) : null}

      {section === "reading" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">
            Time counts only while the tab is visible. It stops when the reader switches away, and it is capped at 20 minutes. Nothing pings the server in the background.
            The median is interpolated from the histogram below. It is approximate, and it is not an average of averages. Views that never sent a beacon are left out of the median, not treated as zero.
          </p>
          <div className="stat-grid">
            <Kpi label="Median recorded time" hint="Approximate median of reading beacons, from the histogram. Unavailable when there are no beacons." value={reading.medianMs == null ? "Unavailable" : formatDuration(reading.medianMs)} delta={null} />
            <Kpi label="25th – 75th percentile" hint="Approximate spread of recorded reads." value={reading.p25Ms == null ? "Unavailable" : `${formatDuration(reading.p25Ms)} – ${formatDuration(reading.p75Ms)}`} delta={null} />
            <Kpi label="90th percentile" hint="Approximate. The last bucket is open-ended and capped at 20 minutes." value={reading.p90Ms == null ? "Unavailable" : formatDuration(reading.p90Ms)} delta={null} />
            <Kpi label="Reached the end" hint="Share of article views whose beacon reported the final 10% of the page, or the end marker. Missing beacons count as not reached." value={formatPercent(rate(current.scrollEnd, current.views))} delta={null} />
          </div>
          <div className="stats-charts">
            <ChartCard title="Reading-time distribution" note="One beacon, one bucket. Under 10s, 10–30s, 30–60s, 1–3m, 3–5m, 5–10m, over 10m.">
              <HistogramChart data={READ_BUCKETS.map((bucket, index) => ({ name: bucket.label, value: current.buckets[index] ?? 0 }))} />
            </ChartCard>
            <ChartCard title="Scroll depth" note="Share of article views that reached each milestone.">
              <HBarChart
               
                name="% of views"
                data={[
                  { name: "25%", value: Math.round((rate(current.scroll25, current.views) ?? 0) * 100) },
                  { name: "50%", value: Math.round((rate(current.scroll50, current.views) ?? 0) * 100) },
                  { name: "75%", value: Math.round((rate(current.scroll75, current.views) ?? 0) * 100) },
                  { name: "90% / end", value: Math.round((rate(current.scrollEnd, current.views) ?? 0) * 100) },
                ]}
              />
            </ChartCard>
          </div>
          <DataTable
            title="Length and recorded time"
            note="Length is estimated from stored text size (about 6 characters per word), not a live word recount. Average time is among recorded reads."
            headers={["Approximate length", "Articles", "Views", "Avg recorded time"]}
            rows={lengthBands(filtered).map((band) => [band.label, formatCount(band.articles), formatCount(band.views), formatDuration(band.avgMs)])}
          />
          <ArticleBars title="Highest average recorded time" note="Only articles with at least 5 recorded reads, so a single long tab does not lead the list." rows={topReading(filtered)} unit="Seconds" />
          <ArticleBars title="Traffic with weaker reading" note="At least 15 views and an engagement rate under 60% of the filtered average. A short piece can look the same; this is not a quality score." rows={weakReading(filtered, reading.engagementRate)} unit="Engagement %" />
        </section>
      ) : null}

      {section === "articles" ? <ArticleTable articles={filtered} query={query} setQuery={setQuery} page={page} setPage={setPage} categories={payload.categories} tags={payload.tags} compare={compare} range={payload.range} /> : null}

      {section === "topics" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">
            Rank = 50% share of views + 30% engagement rate + 20% average recorded time, each compared with the strongest topic. Topics under 8 views are shown but not ranked. An article filed under several topics counts in each of them.
          </p>
          <div className="stats-charts">
            <ChartCard title="Views by topic" note="Popularity by traffic, not by how long people read.">
              <HBarChart name="Views" data={topics.filter((row) => row.views > 0).map((row) => ({ name: short(row.label), value: row.views }))} />
            </ChartCard>
            <ChartCard title="Share of article views" note="Topics with views in this period.">
              <DonutChart data={topics.filter((row) => row.views > 0).slice(0, 8).map((row) => ({ name: short(row.label), value: row.views }))} />
            </ChartCard>
          </div>
          <DataTable
            title="Topics"
            headers={["Topic", "Rank", "Views", "Share", "Engagement", "Avg time", "Best article"]}
            rows={topics.map((row) => [
              row.label,
              row.reliable ? row.score.toFixed(2) : "Too little data",
              formatCount(row.views),
              formatPercent(row.viewShare),
              formatPercent(rate(row.engagedViews, row.views)),
              formatDuration(row.engagedViews > 0 ? row.engagedMs / row.engagedViews : null),
              row.topArticle && row.topArticle.views > 0 ? row.topArticle.title : "—",
            ])}
          />
          <DataTable
            title="Tags"
            note="Tags are optional labels. A tag with very few views is not a conclusion about reader demand."
            headers={["Tag", "Articles", "Views", "Previous views", "Engagement", "Avg time"]}
            rows={tags.map((row) => [
              row.label,
              formatCount(row.articles),
              formatCount(row.views),
              formatCount(row.prevViews),
              formatPercent(rate(row.engagedViews, row.views)),
              formatDuration(row.engagedViews > 0 ? row.engagedMs / row.engagedViews : null),
            ])}
          />
        </section>
      ) : null}

      {section === "sources" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">
            Channel rules for this meter: a UTM parameter counts as a campaign; an empty referrer with no UTM is “No referrer” (typed addresses, bookmarks and apps that hide the referrer are mixed together); a known search host is organic; a known social host is social; anything else external is a referral. This is not Google Analytics attribution.
          </p>
          <div className="stats-charts">
            <ChartCard title="Traffic share" note="All measured page views, not only articles.">
              <DonutChart data={payload.channels.map((row) => ({ name: row.label, value: row.views }))} />
            </ChartCard>
            <ChartCard title="Leading sources" note="Views in this period.">
              <HBarChart name="Views" data={payload.channels.map((row) => ({ name: row.label, value: row.views }))} />
            </ChartCard>
          </div>
          <DataTable
            title="Source detail"
            headers={["Source", "Views", "Previous", "Recorded reads", "Engagement", "Avg time", "Views / read"]}
            rows={payload.channels.map((row) => {
              const prev = payload.prevChannels.find((item) => item.key === row.key)?.views ?? 0;
              return [
                row.label,
                formatCount(row.views),
                formatCount(prev),
                formatCount(row.engagedViews),
                formatPercent(rate(row.engagedViews, row.views)),
                formatDuration(row.engagedViews > 0 ? row.engagedMs / row.engagedViews : null),
                row.engagedViews > 0 ? (row.views / row.engagedViews).toFixed(2) : "—",
              ];
            })}
          />
          <DataTable title="Referring hosts" note="Hostname only. No path, query string or full URL is stored." headers={["Host", "Views"]} rows={payload.referrers.map((row) => [row.host, formatCount(row.views)])} />
          <DataTable title="Campaigns" note="From utm_source, utm_medium and utm_campaign on the landing URL. Empty means that parameter was missing." headers={["Source", "Medium", "Campaign", "Views"]} rows={payload.campaigns.map((row) => [row.source, row.medium, row.campaign, formatCount(row.views)])} />
        </section>
      ) : null}

      {section === "audience" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">Country and region come from Cloudflare’s aggregated network headers. No IP address, city or map of live visitors is stored or shown. Device, browser and system are coarse groups taken from the user-agent and then discarded.</p>
          <div className="stats-charts">
            <ChartCard title="Device mix" note="Views in this period.">
              <DonutChart data={payload.devices.map((row) => ({ name: row.label, value: row.views }))} />
            </ChartCard>
            <ChartCard title="Countries" note="Top aggregated counts. A count of one is still a country total, not an identified person.">
              <HBarChart name="Views" data={payload.countries.map((row) => ({ name: row.label, value: row.views }))} />
            </ChartCard>
          </div>
          <DataTable
            title="Devices"
            headers={["Device", "Views", "Recorded reads", "Engagement", "Avg time"]}
            rows={payload.devices.map((row) => [row.label, formatCount(row.views), formatCount(row.engagedViews), formatPercent(rate(row.engagedViews, row.views)), formatDuration(row.engagedViews > 0 ? row.engagedMs / row.engagedViews : null)])}
          />
          <DataTable title="Browsers" headers={["Browser", "Views"]} rows={payload.browsers.map((row) => [row.label, formatCount(row.views)])} />
          <DataTable title="Operating systems" headers={["System", "Views"]} rows={payload.operatingSystems.map((row) => [row.label, formatCount(row.views)])} />
          <DataTable title="Countries" headers={["Country", "Views", "Recorded reads", "Avg time"]} rows={payload.countries.map((row) => [row.label, formatCount(row.views), formatCount(row.engagedViews), formatDuration(row.engagedViews > 0 ? row.engagedMs / row.engagedViews : null)])} />
          <DataTable title="Regions" note="Only when Cloudflare supplies a region. Not a live map." headers={["Country", "Region", "Views"]} rows={payload.regions.map((row) => [row.countryLabel, row.region, formatCount(row.views)])} />
        </section>
      ) : null}

      {section === "search" ? (
        <section className="desk-section" role="tabpanel">
          <h2>Google Search</h2>
          <Unavailable
            items={[
              ["Search Console", "Not connected. Impressions, clicks, click-through rate, average position, queries and Discover are not available, so none of those numbers are shown."],
              ["What would need connecting", "A Search Console property for this site, read server-side with a credential that never reaches the browser. Until then, pages cannot be flagged for title or snippet review from search data."],
              ["Organic visits", "Browser referrers that look like search engines are in Sources, under Organic search. That is not Search Console and it is not a ranking."],
            ]}
          />
        </section>
      ) : null}

      {section === "journey" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">
            Recirculation rate = article views that recorded at least one click to a different article, divided by article views. Internal clicks are the total of those clicks, not the number of readers. Pages per session is not measured, because there is no session.
          </p>
          <div className="stat-grid">
            <Kpi label="Recirculation rate" hint="Views with one or more clicks to another article, divided by article views." value={formatPercent(rate(current.recircViews, current.views))} delta={null} />
            <Kpi label="Internal article clicks" hint="Total clicks on links to other articles. One reader can contribute several." value={formatCount(current.internalClicks)} delta={null} />
            <Kpi label="Arrivals from an article" hint="Article views whose referrer was another article on this site." value={formatCount(current.inboundInternal)} delta={null} />
            <Kpi label="Clicks per view" hint="Internal article clicks divided by article views." value={current.views > 0 ? (current.internalClicks / current.views).toFixed(2) : "—"} delta={null} />
          </div>
          <DataTable
            title="Articles that send readers onward"
            headers={["Article", "Views", "Internal clicks", "Views with a click", "Click rate"]}
            rows={[...filtered].sort((a, b) => b.internalClicks - a.internalClicks).filter((row) => row.internalClicks > 0).slice(0, 15).map((row) => [row.title, formatCount(row.views), formatCount(row.internalClicks), formatCount(row.recircViews), formatPercent(rate(row.recircViews, row.views))])}
          />
          <DataTable
            title="Articles opened from another article"
            headers={["Article", "Views", "Arrivals from an article"]}
            rows={[...filtered].sort((a, b) => b.inboundInternal - a.inboundInternal).filter((row) => row.inboundInternal > 0).slice(0, 15).map((row) => [row.title, formatCount(row.views), formatCount(row.inboundInternal)])}
          />
        </section>
      ) : null}

      {section === "publishing" ? (
        <section className="desk-section" role="tabpanel">
          <p className="desk-note">
            The first day, 7 days and 28 days are calendar days in Asia/Kolkata from the publication date, not exact 24-hour clocks. A window marked “open” has not had that many days yet, so its total can still grow. Cumulative views are not used to compare articles of different ages.
          </p>
          <div className="stats-charts">
            <ChartCard title="Articles published" note="Count of publication dates in this period.">
              <HBarChart name="Articles" data={publishBars(filtered, payload)} />
            </ChartCard>
          </div>
          <DataTable
            title="Cohort: articles published in this period"
            headers={["Article", "Published", "First day", "First 7 days", "First 28 days", "Window"]}
            rows={filtered
              .filter((row) => row.publishedDay && row.publishedDay >= payload.range.from && row.publishedDay <= payload.range.to)
              .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
              .slice(0, 40)
              .map((row) => [row.title, row.publishedDay ?? "—", formatCount(row.viewsFirstDay ?? 0), formatCount(row.viewsFirst7 ?? 0), formatCount(row.viewsFirst28 ?? 0), row.first28Complete ? "28 days complete" : row.first7Complete ? "7 days complete, 28 open" : "Still in the first week"])}
          />
          <DataTable
            title="Older articles still opened"
            note="Published before this period, with views inside it."
            headers={["Article", "Published", "Views in period", "Lifetime views"]}
            rows={filtered
              .filter((row) => row.publishedDay && row.publishedDay < payload.range.from && row.views > 0)
              .sort((a, b) => b.views - a.views)
              .slice(0, 20)
              .map((row) => [row.title, row.publishedDay ?? "—", formatCount(row.views), formatCount(row.lifetimeViews)])}
          />
        </section>
      ) : null}

      {section === "insights" ? (
        <section className="desk-section" role="tabpanel">
          <h2>Editorial notes</h2>
          <p className="desk-note">Calculated from the figures already on this page. They describe a comparison. They do not prove why it happened.</p>
          <ul className="stats-insights">
            {insights.map((item) => (
              <li key={item.id} className={`stats-insight stats-insight--${item.tone}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
          <h2>Performance</h2>
          <Unavailable
            items={[
              ["Core Web Vitals", "LCP, INP and CLS are not available. Nothing in the project reads CrUX, the GA4 web-vitals report or a Cloudflare Web Analytics beacon, so no timing is invented."],
              ["Slow pages", "Not listed, for the same reason. This panel stays separate from reading time, which is editorial engagement, not page-load speed."],
            ]}
          />
          <Methodology />
        </section>
      ) : null}
    </div>
  );
}

