# Presentation

Five 1920×1080 slides carrying the comparison, as **SVG** — Figma imports SVG into fully
editable text and shape layers, so you can restyle, retype, and rearrange everything after
import. (PNG imports flat; Figma can't import PDF at all.)

| Slide | What it carries |
|---|---|
| `01-title.svg` | Title, the scenario in one sentence, six stack cards with headline counts |
| `02-the-numbers.svg` | **The main table** — 11 rows × 6 stacks |
| `03-capability-matrix.svg` | The same six stacks on capability, including Nola's own gaps |
| `04-where-the-model-lives.svg` | Nola vs. BAML vs. Ax — the three that declare a model somewhere |
| `05-the-sdk-path.svg` | Nola vs. Vercel AI vs. OpenAI SDK — the zod-mirror route |

## Import into Figma

1. In a Figma design file: **File → Place image / Import**, or just drag the five `.svg`
   files onto the canvas. Each lands as its own 1920×1080 group.
2. Select a group → right-click → **Frame selection** if you want true slide frames
   (needed for Figma Slides or prototype flow).
3. Fonts are **Inter** and **Roboto Mono** — both ship with Figma, so nothing substitutes.

## Editing notes

- **Colors** — teal `#0E7C86` is the Nola accent (wash `#E6F2F3`), green `#1E7A3C` marks a
  good outcome, amber `#B06A14` a cost, grey `#9AA1AB` an absence. The encoding is applied to
  every column equally — Ax's greens and Nola's own amber and grey cells included. Keep it
  that way if you edit: the honesty is what makes the table persuasive.
- **Table rules** are separate `<line>` layers; if you delete a row, delete its rule too.
- **The numbers come from the repo** (`../inbox-triage/README.md`), counted from the actual
  files. If the implementations change, recount before reusing these slides.

## A note on the Ax column

Ax ties Nola on line count (87 each) and revives dates automatically, so several of its cells
are green. That is deliberate and correct — the slides argue Nola's case on *where the schema
lives* and *what the compiler can check*, not on Ax being clumsy. Don't "fix" those cells.
