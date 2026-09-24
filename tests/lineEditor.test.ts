import { describe, expect, it } from "vitest";
import { LineEditor, type LineEditorAction } from "../src/terminal/lineEditor";

const submits = (actions: LineEditorAction[]) => actions.filter(a => a.type === "submit").map(a => (a as { line: string }).line);

describe("LineEditor", () => {
  it("echoes typed text and submits on Enter", () => {
    const editor = new LineEditor();
    const actions = editor.feed("ls -la\r");
    expect(actions[0]).toEqual({ type: "echo", data: "ls -la\r\n" });
    expect(submits(actions)).toEqual(["ls -la"]);
    expect(editor.line).toBe("");
  });

  it("handles backspace and cursor movement", () => {
    const editor = new LineEditor();
    editor.feed("echo abXd");
    editor.feed("\u001b[D");      // left
    editor.feed("\u007f");        // backspace removes X
    editor.feed("c");
    expect(editor.line).toBe("echo abcd");
    expect(editor.cursorPosition).toBe(8);
  });

  it("supports application-mode arrows, Home/End and Delete", () => {
    const editor = new LineEditor();
    editor.feed("abc");
    editor.feed("\u001bOH");      // home
    expect(editor.cursorPosition).toBe(0);
    editor.feed("\u001b[3~");     // delete forward
    expect(editor.line).toBe("bc");
    editor.feed("\u001b[F");      // end
    expect(editor.cursorPosition).toBe(2);
  });

  it("submits each line of a multi-line paste once (CRLF safe)", () => {
    const editor = new LineEditor();
    expect(submits(editor.feed("one\r\ntwo\nthree\r"))).toEqual(["one", "two", "three"]);
  });

  it("interrupts and clears the line on Ctrl+C", () => {
    const editor = new LineEditor();
    editor.feed("sleep 10");
    const actions = editor.feed("\u0003");
    expect(actions.some(a => a.type === "interrupt")).toBe(true);
    expect(editor.line).toBe("");
  });

  it("recalls history with up/down and restores the draft", () => {
    const editor = new LineEditor();
    editor.feed("first\r");
    editor.feed("second\r");
    editor.feed("dra");
    editor.feed("\u001b[A");
    expect(editor.line).toBe("second");
    editor.feed("\u001b[A");
    expect(editor.line).toBe("first");
    editor.feed("\u001b[B\u001b[B");
    expect(editor.line).toBe("dra");
  });

  it("does not store blank or duplicate consecutive history entries", () => {
    const editor = new LineEditor();
    editor.feed("ls\r\r   \rls\r");
    expect(editor.historyEntries).toEqual(["ls"]);
  });

  it("Ctrl+U clears to start, Ctrl+E/Ctrl+A move, Ctrl+L clears screen", () => {
    const editor = new LineEditor();
    editor.feed("hello world");
    editor.feed("\u0001");
    expect(editor.cursorPosition).toBe(0);
    editor.feed("\u0005\u0015");
    expect(editor.line).toBe("");
    expect(editor.feed("\u000c")).toEqual([{ type: "clear" }]);
  });

  it("reports EOF only on an empty line", () => {
    const editor = new LineEditor();
    expect(editor.feed("\u0004")).toEqual([{ type: "eof" }]);
    editor.feed("ab\u0001");
    editor.feed("\u0004");
    expect(editor.line).toBe("b");
  });

  it("keeps surrogate pairs intact", () => {
    const editor = new LineEditor();
    editor.feed("echo 😀x\u007f");
    expect(editor.line).toBe("echo 😀");
    editor.feed("\u007f");
    expect(editor.line).toBe("echo ");
  });

  it("ignores bracketed-paste markers and unknown sequences", () => {
    const editor = new LineEditor();
    editor.feed("\u001b[200~pasted\u001b[201~\u001b[1;5C");
    expect(editor.line).toBe("pasted");
  });
});
