import { createFileRoute } from "@tanstack/react-router";
import { PagePending } from "@/components/site/states";
import { useSite } from "@/components/site/use-site";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — DYPOL Blog" },
      { name: "description", content: "DYPOL Blog is the public journal of DYPOL Labs." },
    ],
    links: [{ rel: "canonical", href: "/about" }],
  }),
  pendingComponent: PagePending,
  component: AboutPage,
});

function AboutPage() {
  const site = useSite();
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