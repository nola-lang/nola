import * as p from "@clack/prompts";
import type { Prompter, PrompterOption } from "./flow.js";

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
    note: (message: string) => p.log.message(message),
    intro: (title: string) => p.intro(title),
    outro: (message: string) => p.outro(message),
  };
}
