import {
	Globe02Icon,
	SecurityCheckIcon,
	SecurityLockIcon,
	Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTION_HISTORY, PROGRAMS } from "@/data/aid";

type AidDashboardProps = {
	isSteppedUp: boolean;
	claims?: Record<string, unknown>;
	onStepUp: () => void;
};

export function AidDashboard({
	isSteppedUp,
	claims,
	onStepUp,
}: AidDashboardProps) {
	const givenName = claims?.given_name as string | undefined;
	const familyName = claims?.family_name as string | undefined;
	const nationality = claims?.nationality as string | undefined;

	return (
		<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
			{/* Enrollment Card */}
			<Card className="lg:col-span-2 shadow-sm border-l-4 border-l-success">
				<CardHeader>
					<CardTitle className="flex items-center justify-between">
						<span>Enrollment Status</span>
						<Badge className="bg-success/15 text-success hover:bg-success/15 border-success/30">
							Active
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{isSteppedUp && givenName ? (
						<p className="text-muted-foreground">
							<strong className="text-foreground">
								{givenName} {familyName}
							</strong>
							{nationality && (
								<>
									{" "}
									&middot;{" "}
									<span className="text-foreground">{nationality}</span>
								</>
							)}
						</p>
					) : (
						<p className="text-muted-foreground">
							You are enrolled in the{" "}
							<strong className="text-foreground">
								Emergency Food &amp; Shelter Program
							</strong>
							.
						</p>
					)}
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
						<div className="p-3 bg-secondary/50 rounded-lg">
							<p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
								Benefit Type
							</p>
							<p className="font-medium">Food Ration</p>
						</div>
						<div className="p-3 bg-secondary/50 rounded-lg">
							<p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
								Allowance
							</p>
							<p className="font-medium">Weekly</p>
						</div>
						<div className="p-3 bg-secondary/50 rounded-lg">
							<p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
								Next Pickup
							</p>
							<p className="font-medium">Today</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Collection Pass */}
			<Card className="shadow-lg bg-primary text-primary-foreground border-none relative overflow-hidden">
				<div className="absolute top-0 right-0 p-3 opacity-20">
					<HugeiconsIcon icon={Globe02Icon} size={128} />
				</div>
				<CardHeader className="relative z-10 pb-2">
					<CardTitle className="text-lg font-medium">Collection Pass</CardTitle>
				</CardHeader>
				<CardContent className="relative z-10 flex flex-col items-center gap-4">
					{isSteppedUp ? (
						<>
							<div className="size-40 bg-white rounded-lg p-2 shadow-sm">
								<div className="size-full bg-[url('https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=ZentityAidVerification')] bg-cover rendering-pixelated" />
							</div>
							{givenName && (
								<p className="text-center text-sm font-medium">
									{givenName} {familyName}
									{nationality && ` \u00B7 ${nationality}`}
								</p>
							)}
							<Badge className="bg-white/20 text-white border-white/30">
								Valid
							</Badge>
						</>
					) : (
						<>
							<div className="size-40 bg-white/10 rounded-lg relative flex items-center justify-center backdrop-blur-sm border border-white/20">
								<div className="absolute inset-2 bg-white/5 rounded blur-sm" />
								<div className="relative z-10 text-center space-y-2">
									<HugeiconsIcon
										icon={SecurityLockIcon}
										size={32}
										className="mx-auto opacity-80"
									/>
									<p className="text-xs opacity-80">Identity Required</p>
								</div>
							</div>
							<Button
								onClick={onStepUp}
								size="sm"
								className="bg-white/20 hover:bg-white/30 text-white border border-white/30 gap-2"
							>
								<HugeiconsIcon icon={Shield01Icon} size={14} />
								Generate Collection Pass
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			{/* Programs */}
			<Card className="lg:col-span-2 shadow-none border-dashed bg-muted/30">
				<CardHeader>
					<CardTitle className="text-base text-muted-foreground">
						Available Programs
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-3">
						{PROGRAMS.map((program) => (
							<div
								key={program.id}
								className="flex items-center justify-between p-3 bg-card rounded-lg border shadow-sm"
							>
								<div>
									<p className="font-medium text-sm">{program.name}</p>
									<p className="text-xs text-muted-foreground">
										{program.description}
									</p>
								</div>
								<Badge
									variant={
										program.status === "active" ? "outline" : "secondary"
									}
								>
									{program.status === "active" ? "Active" : "Coming Soon"}
								</Badge>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Collection History (only after step-up) */}
			{isSteppedUp && (
				<Card className="shadow-none border-dashed bg-muted/30">
					<CardHeader>
						<CardTitle className="text-base text-muted-foreground">
							Recent Collections
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{COLLECTION_HISTORY.map((col) => (
								<div
									key={col.id}
									className="p-3 bg-card rounded-lg border shadow-sm"
								>
									<p className="font-medium text-sm">{col.program}</p>
									<p className="text-xs text-muted-foreground">
										{col.date} &middot; {col.location}
									</p>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Privacy Guarantees */}
			<Card className="lg:col-span-3 border-primary/20 bg-primary/5">
				<CardContent className="pt-6">
					<div className="flex items-start gap-3 mb-4">
						<HugeiconsIcon
							icon={SecurityCheckIcon}
							size={20}
							className="text-primary mt-0.5"
						/>
						<h3 className="font-semibold text-foreground">
							Your Privacy Is Protected
						</h3>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
						{[
							"Your biometric data is never stored on our servers",
							"Identity verified without exposing sensitive documents",
							"Only your name and nationality are shared — nothing else",
							"All verification is cryptographically proven, not trusted",
						].map((point) => (
							<div key={point} className="flex items-start gap-2">
								<span className="size-1.5 rounded-full bg-primary mt-2 shrink-0" />
								<p className="text-sm text-muted-foreground">{point}</p>
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
