"use client";

import { defineStepper } from "@/components/stepper";

/**
 * Stepper context - shared by wizard and step components
 *
 * Extracted to avoid import cycles between step components and wizard.
 */
export const { Stepper, useStepper, steps } = defineStepper(
  { id: "email", title: "Email" },
  { id: "id-upload", title: "Upload ID" },
  { id: "liveness", title: "Liveness" },
  { id: "account", title: "Account" }
);

export type StepId = (typeof steps)[number]["id"];
