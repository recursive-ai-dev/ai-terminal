// ============================================================
// LINE EDITOR — local line discipline for sessions without a PTY
//
// With a real pseudo-terminal the shell's own line editor (readline,
// zle, fish) handles every keystroke. The browser preview and the pipe
// fallback have no PTY, so this module provides the essentials: echo,
// cursor movement, backspace/delete, history, Ctrl+C/Ctrl+U/Ctrl+L, and
// multi-line paste. It consumes the raw data xterm.js emits and returns
// ordered actions (echo to screen, submit a line, interrupt, clear).
// ============================================================

export type LineEditorAction =
  | { type: "echo"; data: string }
  | { type: "submit"; line: string }
  | { type: "interrupt" }
  | { type: "clear" }
  | { type: "eof" };

const ESC = "\u001b";

function left(n: number): string {
  return n > 0 ? `${ESC}[${n}D` : "";
}

function right(n: number): string {
  return n > 0 ? `${ESC}[${n}C` : "";
}

export class LineEditor {
  private chars: string[] = [];
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private draft: string[] = [];
  private lastWasCR = false;
  private readonly historyLimit: number;

  constructor(options: { historyLimit?: number } = {}) {
    this.historyLimit = options.historyLimit ?? 500;
  }

  get line(): string {
    return this.chars.join("");
  }

  get cursorPosition(): number {
    return this.cursor;
  }

  get historyEntries(): readonly string[] {
    return this.history;
  }

  /** Forget the current input (e.g. after the session restarts). */
  reset(): void {
    this.chars = [];
    this.cursor = 0;
    this.historyIndex = -1;
    this.draft = [];
  }

  feed(data: string): LineEditorAction[] {
    const actions: LineEditorAction[] = [];
    let echo = "";
    const flushEcho = () => {
      if (echo) actions.push({ type: "echo", data: echo });
      echo = "";
    };

    const input = Array.from(data);
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];

      if (ch === "\n" && this.lastWasCR) {
        // \r\n from a paste: the \r already submitted the line.
        this.lastWasCR = false;
        continue;
      }
      this.lastWasCR = ch === "\r";

      if (ch === "\r" || ch === "\n") {
        echo += "\r\n";
        flushEcho();
        const line = this.line;
        this.remember(line);
        this.reset();
        actions.push({ type: "submit", line });
        continue;
      }

      if (ch === ESC) {
        const consumed = this.escape(input, i);
        echo += consumed.echo;
        i += consumed.length - 1;
        continue;
      }

      switch (ch) {
        case "\u0003": // Ctrl+C
          echo += "^C\r\n";
          flushEcho();
          this.reset();
          actions.push({ type: "interrupt" });
          continue;
        case "\u0004": // Ctrl+D: EOF on an empty line, else delete forward
          if (this.chars.length === 0) {
            flushEcho();
            actions.push({ type: "eof" });
          } else {
            echo += this.deleteForward();
          }
          continue;
        case "\u007f": // Backspace (DEL)
        case "\b":
          echo += this.backspace();
          continue;
        case "\u0001": // Ctrl+A
          echo += left(this.cursor);
          this.cursor = 0;
          continue;
        case "\u0005": // Ctrl+E
          echo += right(this.chars.length - this.cursor);
          this.cursor = this.chars.length;
          continue;
        case "\u0015": // Ctrl+U: delete to start of line
          echo += this.replaceLine(this.chars.slice(this.cursor), 0);
          continue;
        case "\u000b": // Ctrl+K: delete to end of line
          this.chars = this.chars.slice(0, this.cursor);
          echo += `${ESC}[K`;
          continue;
        case "\u000c": // Ctrl+L
          flushEcho();
          actions.push({ type: "clear" });
          continue;
        case "\t":
          echo += this.insert(" ");
          continue;
        default:
          break;
      }

      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue; // other control chars
      echo += this.insert(ch);
    }

    flushEcho();
    return actions;
  }

  private remember(line: string): void {
    if (!line.trim()) return;
    if (this.history[0] !== line) this.history.unshift(line);
    if (this.history.length > this.historyLimit) this.history.length = this.historyLimit;
  }

  private insert(ch: string): string {
    const tail = this.chars.slice(this.cursor);
    this.chars.splice(this.cursor, 0, ch);
    this.cursor++;
    return ch + tail.join("") + left(tail.length);
  }

  private backspace(): string {
    if (this.cursor === 0) return "";
    this.chars.splice(this.cursor - 1, 1);
    this.cursor--;
    const tail = this.chars.slice(this.cursor);
    return `\b${tail.join("")} ${left(tail.length + 1)}`;
  }

  private deleteForward(): string {
    if (this.cursor >= this.chars.length) return "";
    this.chars.splice(this.cursor, 1);
    const tail = this.chars.slice(this.cursor);
    return `${tail.join("")} ${left(tail.length + 1)}`;
  }

  /** Redraw the line with new content and cursor position. */
  private replaceLine(next: string[], cursor: number): string {
    const out = left(this.cursor) + `${ESC}[K` + next.join("") + left(next.length - cursor);
    this.chars = next;
    this.cursor = cursor;
    return out;
  }

  private historyStep(direction: 1 | -1): string {
    if (this.history.length === 0) return "";
    const nextIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + direction));
    if (nextIndex === this.historyIndex) return "";
    if (this.historyIndex === -1) this.draft = [...this.chars];
    this.historyIndex = nextIndex;
    const next = nextIndex === -1 ? this.draft : Array.from(this.history[nextIndex]);
    return this.replaceLine([...next], next.length);
  }

  /** Parse an escape sequence starting at input[start]. */
  private escape(input: string[], start: number): { length: number; echo: string } {
    const next = input[start + 1];
    if (next !== "[" && next !== "O") return { length: next === undefined ? 1 : 2, echo: "" };

    // Collect parameters until the final byte (0x40–0x7e).
    let end = start + 2;
    while (end < input.length) {
      const code = input[end].codePointAt(0) ?? 0;
      if (code >= 0x40 && code <= 0x7e) break;
      end++;
    }
    if (end >= input.length) return { length: input.length - start, echo: "" };

    const sequence = input.slice(start + 1, end + 1).join("");
    const length = end - start + 1;
    switch (sequence) {
      case "[A": case "OA": return { length, echo: this.historyStep(1) };
      case "[B": case "OB": return { length, echo: this.historyStep(-1) };
      case "[C": case "OC": {
        if (this.cursor >= this.chars.length) return { length, echo: "" };
        this.cursor++;
        return { length, echo: right(1) };
      }
      case "[D": case "OD": {
        if (this.cursor === 0) return { length, echo: "" };
        this.cursor--;
        return { length, echo: left(1) };
      }
      case "[H": case "OH": case "[1~": case "[7~": {
        const echo = left(this.cursor);
        this.cursor = 0;
        return { length, echo };
      }
      case "[F": case "OF": case "[4~": case "[8~": {
        const echo = right(this.chars.length - this.cursor);
        this.cursor = this.chars.length;
        return { length, echo };
      }
      case "[3~": return { length, echo: this.deleteForward() };
      default: return { length, echo: "" }; // incl. bracketed-paste markers
    }
  }
}
