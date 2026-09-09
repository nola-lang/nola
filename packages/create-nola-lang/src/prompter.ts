import * as p from "@clack/prompts";
import type { Prompter, PrompterGroup, PrompterOption } from "./flow.js";
import { styleOutro } from "./style.js";

/** The real UI. Bundled into dist by esbuild — @clack/prompts stays a devDep. */
export function clackPrompter(): Prompter {
  return {
    async text(message: string, initialValue: string): Promise<string | null> {
      const answer = await p.text({ message, placeholder: initialValue, defaultValue: initialValue });
      return p.isCancel(answer) ? null : answer;
    },
    async select(message: string, options: PrompterOption[]): Promise<string | null> {
      const answer = await p.select({
        message,
        options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
      });
      return p.isCancel(answer) ? null : (answer as string);
    },
    async confirm(message: string, initialValue: boolean): Promise<boolean | null> {
      const answer = await p.confirm({ message, initialValue });
      return p.isCancel(answer) ? null : answer;
    },
    async multiselect(
      message: string,
      options: PrompterOption[],
      initialValues: string[],
    ): Promise<string[] | null> {
      const answer = await p.multiselect({
        message,
        options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
        initialValues,
        required: false,
      });
      return p.isCancel(answer) ? null : (answer as string[]);
    },
    async groupMultiselect(message: string, groups: PrompterGroup[], initialValues: string[]): Promise<string[] | null> {
      const answer = await p.groupMultiselect({
        message,
        options: Object.fromEntries(
          groups.map((g) => [g.label, g.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))]),
        ),
        initialValues,
        required: false,
        // the group labels are headings, not "tick the whole section" toggles
        selectableGroups: false,
      });
      return p.isCancel(answer) ? null : (answer as string[]);
    },
    progress(title: string) {
      // the timer indicator shows elapsed seconds — an install has no better progress signal
      const s = p.spinner({ indicator: "timer" });
      s.start(title);
      return {
        update: (m: string) => s.message(`${title} — ${m}`),
        done: (m: string) => s.stop(m),
        fail: (m: string) => s.error(m),
      };
    },
    note: (message: string) => p.log.message(message),
    intro: (title: string) => p.intro(title),
    outro: (message: string) => p.outro(styleOutro(message)),
  };
}
