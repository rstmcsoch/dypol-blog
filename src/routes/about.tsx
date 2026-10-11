import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { site } from "@/content/site";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: `${site.labels.aboutTitle} — ${site.name}` },
      { name: "description", content: site.about.paragraphs[0] },
    ],
    links: [{ rel: "canonical", href: "/about" }],
  }),
  pendingComponent: PagePending,
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="page">
      <div className="container">
        <header className="page-header">
          <p className="kicker">{site.labels.aboutKicker}</p>
          <h1 className="page-title">{site.labels.aboutTitle}</h1>
        </header>
        <div className="about-body">
          {site.about.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
