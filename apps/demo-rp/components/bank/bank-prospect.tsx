import { Shield01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PRODUCTS } from "@/data/bank";

type BankProspectProps = {
	onApply: () => void;
};

export function BankProspect({ onApply }: BankProspectProps) {
	return (
		<div className="space-y-8">
			<div className="rounded-xl border border-primary/20 bg-primary/5 p-6">
				<div className="flex items-start gap-3">
					<HugeiconsIcon
						icon={Shield01Icon}
						size={20}
						className="text-primary mt-0.5"
					/>
					<div>
						<p className="font-medium text-foreground">
							Complete verification to activate your account
						</p>
						<p className="text-sm text-muted-foreground mt-1">
							Apply for any product below to start identity verification via
							Zentity. Your documents never leave your control.
						</p>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				{PRODUCTS.map((product) => (
					<Card
						key={product.id}
						className="group hover:shadow-lg transition-all hover:border-primary/30"
					>
						<CardContent className="pt-6 flex flex-col h-full">
							<h3 className="text-lg font-semibold tracking-tight">
								{product.name}
							</h3>
							<p className="text-sm text-muted-foreground mt-2 leading-relaxed">
								{product.description}
							</p>
							<ul className="mt-4 space-y-2 flex-1">
								{product.features.map((feature) => (
									<li
										key={feature}
										className="flex items-center gap-2 text-sm text-muted-foreground"
									>
										<span className="size-1.5 rounded-full bg-primary/60" />
										{feature}
									</li>
								))}
							</ul>
							<Button
								onClick={onApply}
								className="w-full mt-6"
								variant="outline"
							>
								{product.cta}
							</Button>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
