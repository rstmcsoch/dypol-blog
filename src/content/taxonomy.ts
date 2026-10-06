import type { Category, Tag } from "./types";

export const categories: Category[] = [
  {
    id: "systems",
    slug: "systems",
    label: "Systems",
    description: "How a publication is structured, stored, and handed from one step to the next.",
  },
  {
    id: "design",
    slug: "design",
    label: "Design",
    description: "Type, edges, images, and the decisions that keep a long page readable.",
  },
  {
    id: "publishing",
    slug: "publishing",
    label: "Publishing",
    description: "How a piece moves from a draft to something a reader can find.",
  },
  {
    id: "notes",
    slug: "notes",
    label: "Notes",
    description: "Short filings. This topic is empty until something here is published.",
  },
];

export const tags: Tag[] = [
  { id: "structure", slug: "structure", label: "Structure" },
  { id: "type", slug: "type", label: "Type" },
  { id: "layout", slug: "layout", label: "Layout" },
  { id: "media", slug: "media", label: "Media" },
  { id: "workflow", slug: "workflow", label: "Workflow" },
  { id: "index", slug: "index", label: "Index" },
];
