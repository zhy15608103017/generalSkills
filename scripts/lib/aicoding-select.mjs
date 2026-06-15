import readline from "node:readline";

import { listAICodingTargets } from "./skill-utils.mjs";

export function getCliAICodingTarget(args, { isTTY = process.stdin.isTTY } = {}) {
  if (args.aicoding) return args.aicoding;
  if (args.tool) return args.tool;
  return isTTY ? null : "default";
}

export function renderAICodingChoices() {
  return listAICodingTargets()
    .map((target) => {
      const aliases = target.aliases.length > 0 ? ` aliases: ${target.aliases.join(", ")}` : "";
      return `${target.name} - ${target.label} -> ${target.relativePath}${aliases}`;
    })
    .join("\n");
}

export async function promptAICodingTarget({
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  if (!stdin.isTTY) {
    return "default";
  }

  const choices = listAICodingTargets();
  let selectedIndex = 0;

  readline.emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();

  return await new Promise((resolve, reject) => {
    const render = () => {
      stdout.write("\x1b[2J\x1b[0f");
      stdout.write("Select AI coding target:\n\n");
      choices.forEach((choice, index) => {
        const marker = index === selectedIndex ? "> " : "  ";
        stdout.write(`${marker}${choice.name} - ${choice.label} (${choice.relativePath})\n`);
      });
      stdout.write("\nUse Up/Down, then Enter.\n");
    };

    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(Boolean(previousRawMode));
      }
      stdin.pause();
      stdout.write("\n");
    };

    const onKeypress = (_text, key) => {
      if (key?.name === "down") {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
        return;
      }
      if (key?.name === "up") {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
        return;
      }
      if (key?.name === "return" || key?.name === "enter") {
        const selected = choices[selectedIndex].name;
        cleanup();
        resolve(selected);
        return;
      }
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Cancelled."));
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}
