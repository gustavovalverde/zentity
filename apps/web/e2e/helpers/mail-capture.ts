import { createServer, type Server } from "node:http";

/**
 * Stand-in for the Mailpit send API. The E2E web server posts transactional
 * email here (MAILPIT_SEND_API_URL), and specs read the links out of it.
 */
const MAIL_CAPTURE_PORT = 4998;

interface CapturedMail {
  subject: string;
  text: string;
  to: string[];
}

const URL_PATTERN = /https?:\/\/\S+/;

export class MailCapture {
  private readonly messages: CapturedMail[] = [];
  private readonly server: Server;

  private constructor(server: Server) {
    this.server = server;
  }

  static async start(): Promise<MailCapture> {
    let capture: MailCapture | null = null;
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        const payload = JSON.parse(body || "{}") as {
          Subject?: string;
          Text?: string;
          To?: Array<{ Email: string }>;
        };
        capture?.messages.push({
          subject: payload.Subject ?? "",
          text: payload.Text ?? "",
          to: (payload.To ?? []).map((recipient) => recipient.Email),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    capture = new MailCapture(server);
    await new Promise<void>((resolve) =>
      server.listen(MAIL_CAPTURE_PORT, "127.0.0.1", resolve)
    );
    return capture;
  }

  /**
   * The newest link to `to` whose path ends with `path`. Other mail can
   * reach the same address meanwhile, such as an account security notice.
   */
  async waitForLink(
    to: string,
    path: string,
    timeoutMs = 30_000
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const link = this.messages
        .filter((m) => m.to.includes(to))
        .map((m) => URL_PATTERN.exec(m.text)?.[0])
        .findLast((url) => url && new URL(url).pathname.endsWith(path));
      if (link) {
        return link;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`No email with a ${path} link reached ${to}`);
  }

  clear(): void {
    this.messages.length = 0;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
