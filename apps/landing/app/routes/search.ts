import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source.server";

const server = createFromSource(source, { language: "english" });

export async function loader({ request }: { request: Request }) {
  return server.GET(request);
}
