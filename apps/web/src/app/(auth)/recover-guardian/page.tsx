import { Suspense } from "react";

import { RecoverGuardianClient } from "./recover-guardian-client";

export default function RecoverGuardianPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md" />}>
      <RecoverGuardianClient />
    </Suspense>
  );
}
