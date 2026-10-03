// Turns Aider's output into something a chat UI can render.
//
// Two inputs, deliberately different in reliability:
//  - the "record": the slice of Aider's own --chat-history-file written during one turn. This is
//    Aider's canonical log (assistant prose as plain text, tool output as "> " blockquote lines)
//    and is what the final transcript is parsed from, and what gets stored in the database.
//  - the raw stdout stream: noisy (banner, auto-answered prompts, the reply repeated after Aider
//    auto-adds a file and re-asks). Only used for the transient "working..." view.

export interface EditBlock {
  file: string;
  search: string;
  replace: string;
}

export type Segment = { kind: "text"; text: string } | { kind: "edit"; edit: EditBlock };

export interface CommitInfo {
  hash: string;
  message: string;
}

export interface ParsedTurn {
  segments: Segment[];
  appliedFiles: string[];
  commits: CommitInfo[];
  tokens: string | null;
  problems: string[];
  notes: string[];
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function normalize(s: string): string {
  return s.replace(ANSI, "").replace(/\r\n?/g, "\n");
}

const SEARCH_MARK = /^<{5,9} SEARCH\s*$/;
const DIVIDER_MARK = /^={5,9}\s*$/;
const REPLACE_MARK = /^>{5,9} REPLACE\s*$/;

function cleanFileName(line: string): string {
  return line.trim().replace(/^[*`#\s]+|[*`:\s]+$/g, "");
}

/** Splits assistant prose into text and SEARCH/REPLACE edit blocks. With allowPartial, an edit
 *  still being streamed (no REPLACE marker yet) is cut from the text and reported as pending. */
export function splitEditBlocks(
  text: string,
  allowPartial = false,
): { segments: Segment[]; pending: boolean } {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let buf: string[] = [];
  let pending = false;

  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) segments.push({ kind: "text", text: t });
    buf = [];
  };

  let i = 0;
  while (i < lines.length) {
    if (!SEARCH_MARK.test(lines[i])) {
      buf.push(lines[i]);
      i++;
      continue;
    }

    let j = i + 1;
    while (j < lines.length && !DIVIDER_MARK.test(lines[j])) j++;
    let k = j + 1;
    while (k < lines.length && !REPLACE_MARK.test(lines[k])) k++;
    const closed = j < lines.length && k < lines.length;

    // The file name sits above the opening fence: "name.py", "```python", "<<<<<<< SEARCH".
    const savedBuf = buf.slice();
    if (buf.length && buf[buf.length - 1].trim().startsWith("```")) buf.pop();
    let file = "";
    if (buf.length && buf[buf.length - 1].trim() && buf[buf.length - 1].length < 260) {
      file = cleanFileName(buf.pop() as string);
    }

    if (!closed) {
      if (allowPartial) {
        pending = true;
        break;
      }
      buf = savedBuf;
      buf.push(lines[i]);
      i++;
      continue;
    }

    flush();
    segments.push({
      kind: "edit",
      edit: {
        file,
        search: lines.slice(i + 1, j).join("\n"),
        replace: lines.slice(j + 1, k).join("\n"),
      },
    });
    i = lines[k + 1] !== undefined && lines[k + 1].trim() === "```" ? k + 2 : k + 1;
  }

  flush();
  return { segments, pending };
}

const PROMPT_ANSWERED = /\(Y\)es\/\(N\)o/;
const PROBLEM =
  /^(Did not apply edit|The LLM did not conform|# \d+ SEARCH\/REPLACE block failed|.*failed to match|Unable to|Traceback|Error\b|ERROR\b|Warning:|litellm\.|.*(APIConnectionError|AuthenticationError|BadRequestError|RateLimitError|NotFoundError)|.*API connection|Git repo error|Cannot|Can't|Unknown|Only \d+ reflections allowed|(Syntax|Indentation|Name|Import|Module[A-Za-z]*)Error\b)/i;
const PATHLIKE = /^[\w@.\-/\\ ()]+$/;

export function parseAiderRecord(record: string): ParsedTurn {
  const lines = normalize(record).split("\n");

  let start = 0;
  let lastPrompt = -1;
  for (let n = 0; n < lines.length; n++) if (lines[n].startsWith("#### ")) lastPrompt = n;
  if (lastPrompt >= 0) {
    start = lastPrompt + 1;
  } else {
    // No prompt marker: skip the "# aider chat started" header and its banner lines.
    while (start < lines.length && (lines[start].trim() === "" || lines[start].startsWith("#") || lines[start].startsWith(">"))) {
      if (lines[start].startsWith(">") && !lines[start].startsWith("> Aider v") && lines[start].includes("Traceback")) break;
      start++;
    }
  }

  const result: ParsedTurn = {
    segments: [],
    appliedFiles: [],
    commits: [],
    tokens: null,
    problems: [],
    notes: [],
  };

  const blocks: string[] = [];
  let cur: string[] = [];
  const flushBlock = () => {
    const t = cur.join("\n").trim();
    if (t) blocks.push(t);
    cur = [];
  };

  let lastNoteWasPath = false;
  for (let n = start; n < lines.length; n++) {
    const raw = lines[n];
    if (!(raw.startsWith("> ") || raw === ">")) {
      cur.push(raw);
      continue;
    }
    flushBlock();
    const content = raw.slice(2).replace(/\s+$/, "");
    if (!content) continue;

    if (PROMPT_ANSWERED.test(content)) {
      // Auto-answered by --yes-always. The line above it is just the file the question was about.
      if (lastNoteWasPath) result.notes.pop();
      lastNoteWasPath = false;
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = content.match(/^Applied edit to (.+)$/))) {
      if (!result.appliedFiles.includes(m[1])) result.appliedFiles.push(m[1]);
      lastNoteWasPath = false;
    } else if ((m = content.match(/^Commit ([0-9a-f]{6,40}) ?(.*)$/))) {
      if (!result.commits.some((c) => c.hash === m![1])) {
        result.commits.push({ hash: m[1], message: m[2] });
      }
      lastNoteWasPath = false;
    } else if ((m = content.match(/^Tokens: (.+)$/))) {
      result.tokens = m[1];
      lastNoteWasPath = false;
    } else if (PROBLEM.test(content)) {
      // Aider's lint/test reflection loop repeats the same failure several times.
      if (!result.problems.includes(content)) result.problems.push(content);
      lastNoteWasPath = false;
    } else {
      result.notes.push(content);
      lastNoteWasPath = PATHLIKE.test(content) && content.length < 120;
    }
  }
  flushBlock();

  const finalText = blocks.length ? blocks[blocks.length - 1] : "";
  result.segments = splitEditBlocks(finalText).segments;
  return result;
}

const LIVE_NOISE =
  /^(Analytics |You can skip|Added \.aider|Add \.aider|Warning for|https?:\/\/|Aider v|Model:|Main model:|Weak model:|Editor model:|Git repo:|Repo-map:|Restored previous|Use \/help|Update git|Please answer|Open documentation|Scanning repo|Initial repo scan|Tags cache|Using )/;

/** Best-effort view of an in-flight turn from raw stdout. Never used for the stored transcript. */
export function liveView(raw: string): { segments: Segment[]; phase: string | null } {
  const lines = normalize(raw).split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || LIVE_NOISE.test(lines[i]))) i++;

  const draft: string[] = [];
  let tokensAt = -1;
  for (let n = i; n < lines.length; n++) {
    if (/^Tokens: /.test(lines[n])) {
      tokensAt = n;
      break;
    }
    draft.push(lines[n]);
  }

  const { segments, pending } = splitEditBlocks(draft.join("\n"), true);

  let phase: string | null = null;
  if (tokensAt >= 0) {
    phase = "Applying changes...";
    for (let n = lines.length - 1; n > tokensAt; n--) {
      const l = lines[n].trim();
      if (/^Applied edit to /.test(l)) { phase = l; break; }
      if (/^Commit /.test(l)) { phase = "Committing..."; break; }
      if (/^Running /.test(l)) { phase = l; break; }
    }
  } else if (pending) {
    phase = "Writing changes...";
  } else if (segments.length === 0 && i >= lines.length - 1) {
    phase = "Starting Aider...";
  } else if (segments.length === 0) {
    phase = "Thinking...";
  }
  return { segments, phase };
}

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}
