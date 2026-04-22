const ZENTITY_KEY = /^"(zentity:[^"]+)"/;
const KEY_RE = /^"([^"]*)"(?=\s*:)/;
const STR_RE = /^"([^"]*)"/;
const NUM_RE = /^-?\d+\.?\d*/;
const BOOL_RE = /^(true|false|null)/;

function tokenize(json: string): Array<{ className: string; text: string }> {
  const tokens: Array<{ className: string; text: string }> = [];

  for (const line of json.split("\n")) {
    let remaining = line;
    const parts: Array<{ className: string; text: string }> = [];

    while (remaining.length > 0) {
      const zentityMatch = ZENTITY_KEY.exec(remaining);
      if (zentityMatch) {
        parts.push({
          text: zentityMatch[0],
          className: "text-amber-700 font-bold",
        });
        remaining = remaining.slice(zentityMatch[0].length);
        continue;
      }

      const keyMatch = KEY_RE.exec(remaining);
      if (keyMatch) {
        parts.push({ text: keyMatch[0], className: "text-sky-700" });
        remaining = remaining.slice(keyMatch[0].length);
        continue;
      }

      const strMatch = STR_RE.exec(remaining);
      if (strMatch) {
        parts.push({ text: strMatch[0], className: "text-emerald-700" });
        remaining = remaining.slice(strMatch[0].length);
        continue;
      }

      const numMatch = NUM_RE.exec(remaining);
      if (numMatch) {
        parts.push({ text: numMatch[0], className: "text-orange-600" });
        remaining = remaining.slice(numMatch[0].length);
        continue;
      }

      const boolMatch = BOOL_RE.exec(remaining);
      if (boolMatch) {
        parts.push({ text: boolMatch[0], className: "text-purple-600" });
        remaining = remaining.slice(boolMatch[0].length);
        continue;
      }

      parts.push({
        text: remaining[0] ?? "",
        className: "text-muted-foreground",
      });
      remaining = remaining.slice(1);
    }

    tokens.push(...parts);
    tokens.push({ text: "\n", className: "" });
  }

  return tokens;
}

export function JsonBlock({ data }: { data: unknown }) {
  const json = JSON.stringify(data, null, 2);
  const tokens = tokenize(json);

  return (
    <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
      {tokens.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are a deterministic syntax-highlighting stream regenerated from the same input on every render
        <span className={t.className} key={`${i}:${t.className}:${t.text}`}>
          {t.text}
        </span>
      ))}
    </pre>
  );
}
