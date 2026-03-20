import {
  Globe02Icon,
  SecurityCheckIcon,
  SecurityLockIcon,
  Shield01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTION_HISTORY, PROGRAMS } from "@/data/aid";

interface AidDashboardProps {
  claims?: Record<string, unknown> | undefined;
  isSteppedUp: boolean;
  onStepUp: () => void;
}

export function AidDashboard({
  isSteppedUp,
  claims,
  onStepUp,
}: AidDashboardProps) {
  const name = claims?.name as string | undefined;
  const nationality = claims?.nationality as string | undefined;

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {/* Enrollment Card */}
      <Card className="border-l-4 border-l-success shadow-sm lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Enrollment Status</span>
            <Badge className="border-success/30 bg-success/15 text-success hover:bg-success/15">
              Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSteppedUp && name ? (
            <p className="text-muted-foreground">
              <strong className="text-foreground">{name}</strong>
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
          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="mb-1 text-muted-foreground text-xs uppercase tracking-wider">
                Benefit Type
              </p>
              <p className="font-medium">Food Ration</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="mb-1 text-muted-foreground text-xs uppercase tracking-wider">
                Allowance
              </p>
              <p className="font-medium">Weekly</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="mb-1 text-muted-foreground text-xs uppercase tracking-wider">
                Next Pickup
              </p>
              <p className="font-medium">Today</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Collection Pass */}
      <Card className="relative overflow-hidden border-none bg-primary text-primary-foreground shadow-lg">
        <div className="absolute top-0 right-0 p-3 opacity-20">
          <HugeiconsIcon icon={Globe02Icon} size={128} />
        </div>
        <CardHeader className="relative z-10 pb-2">
          <CardTitle className="font-medium text-lg">Collection Pass</CardTitle>
        </CardHeader>
        <CardContent className="relative z-10 flex flex-col items-center gap-4">
          {isSteppedUp ? (
            <>
              <div className="flex size-40 items-center justify-center rounded-lg bg-white p-2 shadow-sm">
                <QRCodeSVG
                  level="M"
                  size={140}
                  value="ZentityAidVerification"
                />
              </div>
              {name && (
                <p className="text-center font-medium text-sm">
                  {name}
                  {nationality && ` \u00B7 ${nationality}`}
                </p>
              )}
              <Badge className="border-white/30 bg-white/20 text-white">
                Valid
              </Badge>
            </>
          ) : (
            <>
              <div className="relative flex size-40 items-center justify-center rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm">
                <div className="absolute inset-2 rounded bg-white/5 blur-sm" />
                <div className="relative z-10 space-y-2 text-center">
                  <HugeiconsIcon
                    className="mx-auto opacity-80"
                    icon={SecurityLockIcon}
                    size={32}
                  />
                  <p className="text-xs opacity-80">Identity Required</p>
                </div>
              </div>
              <Button
                className="gap-2 border border-white/30 bg-white/20 text-white hover:bg-white/30"
                onClick={onStepUp}
                size="sm"
              >
                <HugeiconsIcon icon={Shield01Icon} size={14} />
                Generate Collection Pass
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Programs */}
      <Card className="border-dashed bg-muted/30 shadow-none lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">
            Available Programs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {PROGRAMS.map((program) => (
              <div
                className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-sm"
                key={program.id}
              >
                <div>
                  <p className="font-medium text-sm">{program.name}</p>
                  <p className="text-muted-foreground text-xs">
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
        <Card className="border-dashed bg-muted/30 shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Recent Collections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {COLLECTION_HISTORY.map((col) => (
                <div
                  className="rounded-lg border bg-card p-3 shadow-sm"
                  key={col.id}
                >
                  <p className="font-medium text-sm">{col.program}</p>
                  <p className="text-muted-foreground text-xs">
                    {col.date} &middot; {col.location}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Privacy Guarantees */}
      <Card className="border-primary/20 bg-primary/5 lg:col-span-3">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-start gap-3">
            <HugeiconsIcon
              className="mt-0.5 text-primary"
              icon={SecurityCheckIcon}
              size={20}
            />
            <h3 className="font-semibold text-foreground">
              Your Privacy Is Protected
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              "Identity verified without document uploads or central storage",
              "Only name and nationality shared; no biometrics retained",
              "Consent-free legal basis (GDPR Art. 9): data minimization is structurally enforced",
              "Cryptographic proofs replace trust-based verification",
            ].map((point) => (
              <div className="flex items-start gap-2" key={point}>
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                <p className="text-muted-foreground text-sm">{point}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
