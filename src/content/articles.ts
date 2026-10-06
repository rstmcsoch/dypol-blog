import type { Article } from "./types";

export const articles: Article[] = [
  {
    id: "art-quiet-architecture",
    slug: "quiet-architecture-of-a-page",
    title: "The quiet architecture of a published page",
    excerpt:
      "A page worth reading is mostly structure: a title, a time, a place in the index, and a body that does not fight the measure.",
    status: "published",
    publishedAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
    categoryId: "systems",
    tagIds: ["structure", "layout"],
    motif: "corner",
    featured: true,
    blocks: [
      {
        type: "paragraph",
        text: "Most of what makes a journal feel finished is invisible. The reader meets a title, a date, and a column of type. Under that, the page has already decided what a piece is allowed to be.",
      },
      {
        type: "heading",
        level: 2,
        text: "One shape, used everywhere",
      },
      {
        type: "paragraph",
        text: "A piece needs a stable identity: a slug that does not change, a status that is explicit, a category, and a body made of known blocks. If the public page, the editor, and an automated submission all speak that same shape, nothing has to be translated on the way out.",
      },
      {
        type: "list",
        items: [
          "Draft means it is not on the public index.",
          "Published means a reader can open it.",
          "Unpublished means it was pulled, and it stays out of the index.",
        ],
      },
      {
        type: "heading",
        level: 2,
        text: "What the page refuses",
      },
      {
        type: "paragraph",
        text: "The body is not a bucket of unmarked HTML. Paragraphs, headings, lists, quotations, and code are separate. That keeps the reading column predictable and keeps a bad paste from becoming the layout.",
      },
      {
        type: "quote",
        text: "If a field can be guessed, an automated writer will guess it wrong. Name it.",
      },
      {
        type: "paragraph",
        text: "The sample essays in this journal exist to show that structure. They are not a history of the lab. They are a demonstration of the page.",
      },
    ],
  },
  {
    id: "art-hard-edge",
    slug: "hard-edge-returns",
    title: "Borders, type, and the return of the hard edge",
    excerpt:
      "A hard edge is not decoration. It is how a publication tells you where one thing ends and the next begins.",
    status: "published",
    publishedAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    categoryId: "design",
    tagIds: ["type", "layout"],
    motif: "split",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "Soft cards and blurred shadows make everything feel like the same surface. A journal needs the opposite: a rule you can see, a shadow that is honestly offset, a corner that does not pretend to be a pebble.",
      },
      {
        type: "heading",
        level: 2,
        text: "Black, white, then one color",
      },
      {
        type: "paragraph",
        text: "The day page is white. The night page is black. Those two carry the structure. A single orange is allowed on a stamp, a band, or a plate — and only there does the grain appear. The type stays clean.",
      },
      {
        type: "paragraph",
        text: "Headlines can be loud. Body text cannot. The column stays narrow enough to read, and the type size does not jump just because the screen is wide.",
      },
    ],
  },
  {
    id: "art-machine",
    slug: "what-a-machine-should-send",
    title: "What a machine should send when it publishes",
    excerpt:
      "An automated writer should submit a document, not pretend to click through a form. The document has to be the same one a person would save.",
    status: "published",
    publishedAt: "2026-09-26T08:00:00.000Z",
    updatedAt: "2026-09-26T08:00:00.000Z",
    categoryId: "systems",
    tagIds: ["workflow", "structure"],
    motif: "band",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "If a publishing flow depends on a particular model, a particular vendor, or a screen full of buttons, it will break the moment any of those change. The durable part is the payload.",
      },
      {
        type: "heading",
        level: 2,
        text: "A payload, not a performance",
      },
      {
        type: "paragraph",
        text: "The useful submission names its fields, validates them, and returns a clear success or a list of errors. It can be retried. It does not invent a second article format for machines.",
      },
      {
        type: "code",
        language: "json",
        code: '{\n  "slug": "working-title",\n  "status": "draft",\n  "title": "Working title",\n  "categoryId": "systems"\n}',
      },
      {
        type: "paragraph",
        text: "A person using an editor later should produce this same object. The public page should render this same object. The agent is replaceable. The article is not.",
      },
    ],
  },
  {
    id: "art-reading-width",
    slug: "reading-width",
    title: "Reading width is a product decision",
    excerpt:
      "A line that runs the full width of a monitor is not generous. It is harder to read. The measure should stay put.",
    status: "published",
    publishedAt: "2026-09-20T08:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
    categoryId: "design",
    tagIds: ["type", "layout"],
    motif: "edge",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "On a phone, the danger is type that is too big for the screen and margins that disappear. On a desktop, the danger is a paragraph that stretches until the eye loses the next line.",
      },
      {
        type: "paragraph",
        text: "A reading column around sixty-six characters solves the second problem without making the first one worse. Headlines can be wider. The body should not copy them.",
      },
      {
        type: "heading",
        level: 2,
        text: "Metadata stays out of the way",
      },
      {
        type: "paragraph",
        text: "Date, topic, and length belong near the title, in a smaller voice. They should not become a second article. If they wrap on a narrow screen, they wrap. They do not overflow.",
      },
    ],
  },
  {
    id: "art-index",
    slug: "an-index-not-a-feed",
    title: "An index, not a feed",
    excerpt:
      "A journal can show what it has without pretending the list is infinite. Numbers, rules, and titles are enough.",
    status: "published",
    publishedAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z",
    categoryId: "publishing",
    tagIds: ["index", "layout"],
    motif: "stack",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "A feed asks you to keep scrolling. An index tells you where you are. For a small publication, the index is the more honest object: a numbered list, a topic, a date, a title you can scan.",
      },
      {
        type: "paragraph",
        text: "The homepage can still lead with one piece. The rest of the journal does not need to become a grid of identical cards. A rule between rows is a clearer invitation.",
      },
      {
        type: "list",
        ordered: true,
        items: [
          "Put the newest piece where the eye lands first.",
          "Give the next few a shared band, not a new visual system.",
          "Let the remainder be a list.",
        ],
      },
    ],
  },
  {
    id: "art-three-states",
    slug: "three-states",
    title: "Draft, published, withdrawn",
    excerpt:
      "A piece should not be public because somebody forgot a checkbox. The state is part of the article, and the index trusts it.",
    status: "published",
    publishedAt: "2026-09-08T08:00:00.000Z",
    updatedAt: "2026-09-08T08:00:00.000Z",
    categoryId: "publishing",
    tagIds: ["workflow", "structure"],
    motif: "stamp",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "Three states are enough until a newsroom actually needs more. Draft: still being written. Published: on the site. Unpublished: kept, but not listed and not readable at its old address.",
      },
      {
        type: "paragraph",
        text: "The public site never infers this from a missing date or a hidden flag buried in a template. Queries ask for published pieces and ignore the rest. A topic with only drafts looks empty on purpose.",
      },
      {
        type: "quote",
        text: "Empty is a real state. It should look like the rest of the journal, not like a missing page.",
      },
    ],
  },
  {
    id: "art-frame",
    slug: "the-frame-around-a-picture",
    title: "The frame around a picture",
    excerpt:
      "Media should sit in a frame that already has a size. The page must not jump when the file arrives, and the picture must not stretch.",
    status: "published",
    publishedAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z",
    categoryId: "design",
    tagIds: ["media", "layout"],
    motif: "corner",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "A cover is a promise about the piece, not a second layout. It keeps a fixed ratio, it has a description if it is a real image, and it loads after the title when it is not the first thing on the screen.",
      },
      {
        type: "paragraph",
        text: "Until a piece has a picture, the frame can still be a plate: a number, a topic, a block of color. The plate is the same component the photograph will replace. The page does not grow a new hole.",
      },
      {
        type: "heading",
        level: 2,
        text: "Grain stays on the color",
      },
      {
        type: "paragraph",
        text: "Noise on white type makes a page look dirty. Noise on an orange field looks like print. The frame uses the second one and leaves the headline alone.",
      },
    ],
  },
  {
    id: "art-notes-draft",
    slug: "desk-notes",
    title: "Desk notes",
    excerpt: "A draft that should not appear on the public index.",
    status: "draft",
    publishedAt: null,
    updatedAt: "2026-10-05T08:00:00.000Z",
    categoryId: "notes",
    tagIds: ["workflow"],
    motif: "edge",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "This draft exists so the public queries have something to exclude. It is not a published essay.",
      },
    ],
  },
  {
    id: "art-withdrawn",
    slug: "withdrawn-note",
    title: "A note that was withdrawn",
    excerpt: "An unpublished piece. It stays in the record and off the site.",
    status: "unpublished",
    publishedAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-20T08:00:00.000Z",
    categoryId: "publishing",
    tagIds: ["workflow"],
    motif: "band",
    featured: false,
    blocks: [
      {
        type: "paragraph",
        text: "This piece was withdrawn. The public index should not list it, and its address should not resolve.",
      },
    ],
  },
];
