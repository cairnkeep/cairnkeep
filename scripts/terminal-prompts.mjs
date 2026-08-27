import { emitKeypressEvents } from "node:readline";

function promptError(message, status = 1) {
  const error = new Error(message);
  error.name = "TerminalPromptError";
  error.status = status;
  return error;
}

function normalizedChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) throw promptError("A terminal prompt requires at least one choice.");
  const normalized = choices.map((choice) => Object.freeze({
    value: String(choice.value),
    label: String(choice.label),
    hint: choice.hint ? String(choice.hint) : "",
  }));
  if (new Set(normalized.map(({ value }) => value)).size !== normalized.length) {
    throw promptError("Terminal prompt choices must have unique values.");
  }
  return Object.freeze(normalized);
}

export function supportsTerminalPrompts(input, output, env = process.env) {
  return Boolean(
    input?.isTTY
      && output?.isTTY
      && typeof input.setRawMode === "function"
      && env.TERM !== "dumb",
  );
}

async function runKeypressPrompt({ input, output, draw, accept }) {
  emitKeypressEvents(input);
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = typeof input.isPaused === "function" ? input.isPaused() : false;
  let renderedLines = 0;
  let settled = false;
  let keypressHandler = null;
  let rawChanged = false;
  let resumed = false;
  let cursorHidden = false;

  const render = () => {
    const lines = draw();
    if (renderedLines > 0) output.write(`\x1b[${renderedLines}A\r\x1b[0J`);
    output.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  };

  const clear = () => {
    if (renderedLines > 0) output.write(`\x1b[${renderedLines}A\r\x1b[0J`);
    renderedLines = 0;
  };

  try {
    if (!wasRaw) {
      input.setRawMode(true);
      rawChanged = true;
    }
    if (wasPaused && typeof input.resume === "function") {
      input.resume();
      resumed = true;
    }
    output.write("\x1b[?25l");
    cursorHidden = true;
    render();
    return await new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        input.removeListener("keypress", onKeypress);
        callback(value);
      };
      const onKeypress = (text, key = {}) => {
        try {
          if ((key.ctrl && key.name === "c") || key.name === "escape") {
            finish(reject, promptError("Setup cancelled.", 130));
            return;
          }
          const result = accept(text, key);
          if (result?.done) finish(resolve, result.value);
          else render();
        } catch (error) {
          finish(reject, error);
        }
      };
      keypressHandler = onKeypress;
      input.on("keypress", onKeypress);
    });
  } finally {
    if (keypressHandler) input.removeListener("keypress", keypressHandler);
    clear();
    if (cursorHidden) output.write("\x1b[?25h");
    if (rawChanged) input.setRawMode(false);
    if (resumed && typeof input.pause === "function") input.pause();
  }
}

function movement(key, cursor, length) {
  if (key.name === "up" || key.name === "k") return (cursor - 1 + length) % length;
  if (key.name === "down" || key.name === "j") return (cursor + 1) % length;
  if (key.name === "home") return 0;
  if (key.name === "end") return length - 1;
  return cursor;
}

export async function selectOnePrompt({ message, choices, initialValue, input, output }) {
  const options = normalizedChoices(choices);
  let cursor = Math.max(0, options.findIndex(({ value }) => value === initialValue));
  const selected = await runKeypressPrompt({
    input,
    output,
    draw: () => [
      `? ${message} (Up/Down to move, Enter to select)`,
      ...options.map((choice, index) => `${index === cursor ? ">" : " "} ${choice.label}${choice.hint ? ` - ${choice.hint}` : ""}`),
    ],
    accept: (text, key) => {
      cursor = movement(key, cursor, options.length);
      if (key.name === "return" || key.name === "enter") return { done: true, value: options[cursor].value };
      const number = Number.parseInt(text, 10);
      if (Number.isInteger(number) && number >= 1 && number <= options.length) {
        cursor = number - 1;
        return { done: true, value: options[cursor].value };
      }
      return null;
    },
  });
  const label = options.find(({ value }) => value === selected)?.label ?? selected;
  output.write(`> ${message}: ${label}\n`);
  return selected;
}

export async function selectManyPrompt({ message, choices, selectedValues = [], input, output, minimum = 1 }) {
  const options = normalizedChoices(choices);
  const allowed = new Set(options.map(({ value }) => value));
  const selected = new Set(selectedValues.filter((value) => allowed.has(value)));
  let cursor = 0;
  let validation = "";
  const values = await runKeypressPrompt({
    input,
    output,
    draw: () => [
      `? ${message} (Up/Down to move, Space to toggle, A to toggle all, Enter to continue)`,
      ...options.map((choice, index) => `${index === cursor ? ">" : " "} [${selected.has(choice.value) ? "x" : " "}] ${choice.label}${choice.hint ? ` - ${choice.hint}` : ""}`),
      validation,
    ],
    accept: (text, key) => {
      cursor = movement(key, cursor, options.length);
      if (key.name === "space" || text === " ") {
        const value = options[cursor].value;
        if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        validation = "";
      } else if (text?.toLowerCase() === "a") {
        if (selected.size === options.length) selected.clear();
        else for (const { value } of options) selected.add(value);
        validation = "";
      } else if (key.name === "return" || key.name === "enter") {
        if (selected.size < minimum) {
          validation = `  Select at least ${minimum} option${minimum === 1 ? "" : "s"}.`;
          output.write("\x07");
        } else {
          return { done: true, value: options.filter(({ value }) => selected.has(value)).map(({ value }) => value) };
        }
      }
      return null;
    },
  });
  const labels = options.filter(({ value }) => values.includes(value)).map(({ label }) => label);
  output.write(`> ${message}: ${labels.join(", ")}\n`);
  return values;
}
