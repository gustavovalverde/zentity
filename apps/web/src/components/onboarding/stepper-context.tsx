"use client";

import { defineStepper } from "@/components/stepper";

/**
 * Stepper context - shared by wizard and step components
 *
 * Extracted to avoid import cycles between step components and wizard.
 * Step definitions follow stepperize pattern with id, title, and description.
 */
export const { Stepper, useStepper, steps, utils } = defineStepper(
  {
    id: "email",
    title: "Email",
    description: "Verify your email address",
  },
  {
    id: "id-upload",
    title: "Upload ID",
    description: "Scan your identity document",
  },
  {
    id: "liveness",
    title: "Liveness",
    description: "Verify you're a real person",
  },
  {
    id: "account",
    title: "Account",
    description: "Create your secure account",
  }
);

export type StepId = (typeof steps)[number]["id"];
