import { createInterface } from "node:readline";

const SUBMIT_CHARS = new Set(["\n", "\r", "\u0004"]);
const BACKSPACE_CHARS = new Set(["\u007F", "\b"]);

function createReadline(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

export function promptText(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createReadline();
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createReadline();
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    process.stderr.write(question);

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let password = "";

    const cleanup = () => {
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw ?? false);
      }
      stdin.removeListener("data", onData);
      rl.close();
    };

    const onData = (chunk: Buffer) => {
      const char = chunk.toString();

      if (SUBMIT_CHARS.has(char)) {
        cleanup();
        process.stderr.write("\n");
        resolve(password);
        return;
      }

      if (char === "\u0003") {
        process.stderr.write("\n");
        process.exit(1);
      }

      if (BACKSPACE_CHARS.has(char) && password.length > 0) {
        password = password.slice(0, -1);
        process.stderr.write("\b \b");
        return;
      }

      if (char.charCodeAt(0) >= 32) {
        password += char;
        process.stderr.write("*");
      }
    };

    stdin.on("data", onData);
    stdin.resume();
  });
}
