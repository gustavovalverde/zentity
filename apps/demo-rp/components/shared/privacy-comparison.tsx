type PrivacyComparisonProps = {
	notShared: string[];
};

export function PrivacyComparison({ notShared }: PrivacyComparisonProps) {
	return (
		<div className="space-y-3">
			{notShared.map((item) => (
				<div
					key={item}
					className="flex items-center gap-3 rounded-lg border border-dashed p-3"
				>
					<svg
						className="size-4 text-muted-foreground"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
						/>
					</svg>
					<span className="text-sm text-muted-foreground">{item}</span>
				</div>
			))}
			<p className="pt-2 text-center text-xs text-muted-foreground">
				Never transmitted to us.
			</p>
		</div>
	);
}
