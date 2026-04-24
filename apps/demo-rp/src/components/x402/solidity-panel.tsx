import type { PohClaims } from "@/data/x402";
import { SOLIDITY_FACILITATOR, SOLIDITY_IS_COMPLIANT } from "@/data/x402";

const KEYWORD_SET = new Set([
  "contract",
  "function",
  "interface",
  "external",
  "view",
  "returns",
  "public",
  "immutable",
  "address",
  "uint8",
]);
const TYPE_SET = new Set(["IIdentityRegistryMirror", "bool"]);
const TOKEN_RE =
  /\b(contract|function|interface|external|view|returns|public|immutable|address|uint8|IIdentityRegistryMirror|bool|mirror\.\w+)\b|\/\//;

function classifyWord(word: string): string {
  if (KEYWORD_SET.has(word)) {
    return "text-purple-600";
  }
  if (TYPE_SET.has(word)) {
    return "text-sky-700";
  }
  if (word.startsWith("mirror.")) {
    return "text-amber-700 font-bold";
  }
  return "text-foreground";
}

function highlightSolidity(
  code: string
): Array<{ className: string; text: string }> {
  const tokens: Array<{ className: string; text: string }> = [];

  for (const line of code.split("\n")) {
    let rest = line;

    while (rest.length > 0) {
      if (rest.startsWith("//")) {
        tokens.push({ text: rest, className: "text-muted-foreground italic" });
        rest = "";
        break;
      }

      const m = TOKEN_RE.exec(rest);
      if (!m || m.index === undefined) {
        tokens.push({ text: rest, className: "text-foreground" });
        rest = "";
        break;
      }

      if (m.index > 0) {
        tokens.push({
          text: rest.slice(0, m.index),
          className: "text-foreground",
        });
      }

      const word = m[0];
      if (word === "//") {
        tokens.push({
          text: rest.slice(m.index),
          className: "text-muted-foreground italic",
        });
        rest = "";
        break;
      }

      tokens.push({ text: word, className: classifyWord(word) });
      rest = rest.slice(m.index + word.length);
    }

    tokens.push({ text: "\n", className: "" });
  }

  return tokens;
}

function CodeBlock({ code, title }: { code: string; title: string }) {
  const tokens = highlightSolidity(code);

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        {title}
      </h4>
      <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-[11px] leading-relaxed">
        {tokens.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are a deterministic syntax-highlighting stream regenerated from the same input on every render
          <span className={t.className} key={`${i}:${t.className}:${t.text}`}>
            {t.text}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function SolidityPanel({ pohClaims }: { pohClaims: PohClaims | null }) {
  return (
    <div className="space-y-4">
      <CodeBlock code={SOLIDITY_FACILITATOR} title="x402 Facilitator Pattern" />
      <CodeBlock code={SOLIDITY_IS_COMPLIANT} title="HTTP-Level Check" />

      {pohClaims && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <h4 className="mb-2 font-medium text-[10px] text-amber-700 uppercase tracking-wider">
            Your Compliance Data
          </h4>
          <div className="space-y-1 font-mono text-xs">
            <div>
              <span className="text-muted-foreground">requiredLevel: </span>
              <span className="text-orange-600">2</span>
              <span className="text-muted-foreground"> → userTier: </span>
              <span
                className={
                  pohClaims.tier >= 2 ? "text-emerald-700" : "text-red-600"
                }
              >
                {pohClaims.tier}
              </span>
              <span className="text-muted-foreground">
                {" "}
                {pohClaims.tier >= 2 ? "✓ passes" : "✗ fails"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">
                FHE.select(compliant, amount, zero) →{" "}
              </span>
              <span
                className={
                  pohClaims.verified ? "text-emerald-700" : "text-orange-600"
                }
              >
                {pohClaims.verified ? "amount" : "zero"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
