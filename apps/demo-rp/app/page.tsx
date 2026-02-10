import {
	BankIcon,
	FlashIcon,
	Globe02Icon,
	Wallet01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Scenario = {
	href: string;
	theme: string;
	icon: IconSvgElement | null;
	brandName: string;
	brandSub: string;
	brandFont: string;
	title: string;
	description: string;
	badges: string[];
};

const SCENARIOS: Scenario[] = [
	{
		href: "/bank",
		theme: "bank",
		icon: BankIcon,
		brandName: "Velocity Private",
		brandSub: "Trusted Finance",
		brandFont: "font-serif tracking-wide font-medium",
		title: "Instant Onboarding",
		description:
			"Securely verify high-net-worth clients without storing documents. Trigger step-up auth for large transactions.",
		badges: ["Identity Verification", "Step-Up Auth"],
	},
	{
		href: "/exchange",
		theme: "exchange",
		icon: FlashIcon,
		brandName: "NOVAX",
		brandSub: "Global Markets",
		brandFont: "font-mono tracking-tighter font-bold uppercase",
		title: "Regulatory Compliance",
		description:
			"Verify nationality and residence for trading compliance without burdening users with document uploads.",
		badges: ["Global KYC", "Zero-Storage"],
	},
	{
		href: "/wine",
		theme: "wine",
		icon: null,
		brandName: "Vino Delivery",
		brandSub: "Fine Goods",
		brandFont: "font-serif tracking-tight text-xl italic",
		title: "Age Gating",
		description:
			"Instant 21+ verification for restricted goods. Zero interactions required if credentials are present.",
		badges: ["Age Verification", "Privacy First"],
	},
	{
		href: "/aid",
		theme: "aid",
		icon: Globe02Icon,
		brandName: "Relief Global",
		brandSub: "Humanitarian Aid",
		brandFont: "font-bold tracking-tight",
		title: "Aid Distribution",
		description:
			"Secure identity verification for aid recipients. Prevent fraud while protecting vulnerable populations' data.",
		badges: ["Anti-Fraud", "Data Minimization"],
	},
	{
		href: "/veripass",
		theme: "veripass",
		icon: Wallet01Icon,
		brandName: "VeriPass",
		brandSub: "Digital Credentials",
		brandFont: "font-bold tracking-tight",
		title: "Credential Wallet",
		description:
			"Receive a verifiable credential via OID4VCI, then selectively present claims to different verifiers using SD-JWT.",
		badges: ["OID4VCI", "Selective Disclosure"],
	},
];

function WineIcon({ className }: { className?: string }) {
	return (
		<svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
			<path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.118 3.118 0 01-2.22.92H9.69a3.118 3.118 0 01-2.22-.92L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5" />
		</svg>
	);
}

export default function Page() {
	return (
		<div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/10">
			{/* Hero */}
			<header className="relative overflow-hidden bg-card border-b pb-8 pt-16 md:pt-20 px-6">
				<div className="absolute top-0 inset-x-0 h-40 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

				<div className="relative mx-auto max-w-5xl text-center space-y-5">
					<div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm font-medium text-foreground border border-border">
						<span className="size-2 rounded-full bg-success animate-pulse" />
						Zentity Demo Platform
					</div>

					<h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
						Seamless Identity, <br className="hidden md:block" />
						<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-chart-3">
							Built for Trust.
						</span>
					</h1>

					<p className="mx-auto max-w-2xl text-lg md:text-xl text-muted-foreground leading-relaxed">
						Experience five distinct business scenarios powered by
						privacy-preserving identity. Verify users instantly without managing
						sensitive data.
					</p>
				</div>
			</header>

			{/* Scenarios Grid */}
			<div className="mx-auto max-w-7xl px-6 py-12">
				<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
					{SCENARIOS.map((s) => (
						<Link key={s.href} href={s.href} className="group">
							<Card className="h-full overflow-hidden border-0 shadow-xl shadow-muted/60 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ring-1 ring-border bg-card">
								<div
									data-theme={s.theme}
									className="relative h-36 bg-primary p-6 flex flex-col justify-between overflow-hidden group-hover:brightness-110 transition-all"
								>
									<div className="flex items-center gap-3 relative z-10">
										{s.icon ? (
											<div className="flex size-10 items-center justify-center rounded bg-primary-foreground text-primary">
												<HugeiconsIcon icon={s.icon} size={24} />
											</div>
										) : (
											<div className="text-primary-foreground">
												<WineIcon className="size-10" />
											</div>
										)}
										<span
											className={`text-primary-foreground text-lg ${s.brandFont}`}
										>
											{s.brandName}
										</span>
									</div>
									<div className="text-primary-foreground/70 text-sm font-light relative z-10">
										{s.brandSub}
									</div>
								</div>
								<CardContent className="p-6 space-y-3">
									<h3 className="text-xl font-bold">{s.title}</h3>
									<p className="text-muted-foreground leading-relaxed text-sm">
										{s.description}
									</p>
									<div
										data-theme={s.theme}
										className="pt-3 flex flex-wrap gap-2"
									>
										{s.badges.map((badge) => (
											<Badge
												key={badge}
												variant="secondary"
												className="bg-primary/10 text-primary hover:bg-primary/15"
											>
												{badge}
											</Badge>
										))}
									</div>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			</div>

			{/* How It Works */}
			<section className="bg-card border-y py-12 px-6">
				<div className="mx-auto max-w-4xl text-center">
					<h2 className="text-3xl font-bold mb-10">How it works</h2>

					<div className="grid md:grid-cols-3 gap-8 relative">
						<div className="hidden md:block absolute top-8 left-0 w-full h-0.5 bg-border -z-10" />

						{[
							{
								step: "1",
								title: "Connect",
								desc: "User chooses to sign in with their Zentity Wallet.",
							},
							{
								step: "2",
								title: "Verify",
								desc: "Requested claims are cryptographically verified instantly.",
							},
							{
								step: "3",
								title: "Access",
								desc: "User gains access. No PII is stored on your servers.",
							},
						].map((item) => (
							<div key={item.step} className="relative group">
								<div className="size-16 mx-auto bg-card rounded-full border shadow-sm flex items-center justify-center mb-4 z-10 group-hover:border-primary/50 group-hover:shadow-primary/10 transition-all">
									<span className="text-xl font-bold text-muted-foreground/50 group-hover:text-primary transition-colors">
										{item.step}
									</span>
								</div>
								<h3 className="text-lg font-bold mb-2">{item.title}</h3>
								<p className="text-muted-foreground text-sm leading-relaxed">
									{item.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="py-10 text-center text-muted-foreground text-sm">
				<p>&copy; 2025 Zentity Demo Platform</p>
			</footer>
		</div>
	);
}
