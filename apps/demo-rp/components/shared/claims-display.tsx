import { Badge } from "@/components/ui/badge";

type ClaimsDisplayProps = {
	claims: Record<string, unknown>;
};

const HIDDEN_KEYS = new Set([
	"sub",
	"iss",
	"aud",
	"exp",
	"iat",
	"id",
	"emailVerified",
]);

function isSimpleValue(value: unknown): value is string | number | boolean {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function formatSimple(value: string | number | boolean): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

function getClaimIcon(key: string, value: unknown): keyof typeof iconMap {
	if (typeof value === "boolean") return value ? "check" : "x";
	if (key.includes("verified") || key.includes("level")) return "shield";
	return "info";
}

const iconMap = {
	check: (
		<svg
			aria-hidden="true"
			className="size-4 text-success"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
		</svg>
	),
	x: (
		<svg
			aria-hidden="true"
			className="size-4 text-destructive"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M6 18L18 6M6 6l12 12"
			/>
		</svg>
	),
	shield: (
		<svg
			aria-hidden="true"
			className="size-4 text-primary"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
			/>
		</svg>
	),
	info: (
		<svg
			aria-hidden="true"
			className="size-4 text-muted-foreground"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	),
};

export function ClaimsDisplay({ claims }: Readonly<ClaimsDisplayProps>) {
	const entries = Object.entries(claims).filter(
		([key]) => !HIDDEN_KEYS.has(key),
	);

	if (entries.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No claims received from Zentity.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{entries.map(([key, value]) => {
				if (value === null || value === undefined) return null;
				const icon = iconMap[getClaimIcon(key, value)];

				if (isSimpleValue(value)) {
					return (
						<div
							key={key}
							className="flex items-center gap-3 rounded-lg border bg-card/50 p-3"
						>
							{icon}
							<span className="shrink-0 font-mono text-sm text-muted-foreground">
								{key}
							</span>
							<Badge
								variant="secondary"
								className="ml-auto max-w-[60%] truncate font-mono text-xs"
								title={formatSimple(value)}
							>
								{formatSimple(value)}
							</Badge>
						</div>
					);
				}

				return (
					<div
						key={key}
						className="space-y-1.5 rounded-lg border bg-card/50 p-3"
					>
						<div className="flex items-center gap-3">
							{icon}
							<span className="font-mono text-sm text-muted-foreground">
								{key}
							</span>
						</div>
						<pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs text-muted-foreground">
							{JSON.stringify(value, null, 2)}
						</pre>
					</div>
				);
			})}
		</div>
	);
}
