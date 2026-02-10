import { getAuth } from "@/lib/auth";

async function handle(request: Request) {
	try {
		return await getAuth().handler(request);
	} catch (error) {
		console.error("[demo-rp auth]", error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}

export async function GET(request: Request) {
	return handle(request);
}

export async function POST(request: Request) {
	return handle(request);
}
