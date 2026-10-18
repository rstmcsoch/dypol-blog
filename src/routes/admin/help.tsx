import { createFileRoute } from "@tanstack/react-router";
import { Markdown } from "@/components/markdown";
import guide from "../../../docs/ADMIN-GUIDE.md?raw";

export const Route = createFileRoute("/admin/help")({
  component: HelpAdmin,
});

function HelpAdmin() {
  return (
    <div className="adm-help">
      <p className="desk-kicker">Help</p>
      <Markdown source={guide} />
    </div>
  );
}
