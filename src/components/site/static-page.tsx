import { Markdown } from "@/components/markdown";

export type PageView = {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
};

function updatedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** A standard reader-facing page (About, policies, contact…). */
export function StaticPage({ page }: { page: PageView }) {
  const updated = updatedLabel(page.updatedAt);
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">DYPOL Blog</p>
          <h1 className="page-title">{page.title}</h1>
          {updated && page.slug !== "about" && page.slug !== "contact" ? <p className="page-updated">Last updated {updated}</p> : null}
        </header>
        <div className="about-body page-body">
          <Markdown source={page.body} />
        </div>
      </div>
    </div>
  );
}
