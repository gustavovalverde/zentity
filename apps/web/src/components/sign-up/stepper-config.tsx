"use client";

import { defineStepper } from "@/components/stepper";

/**
 * Stepper context - shared by wizard and step components
 *
 * Extracted to avoid import cycles between step components and wizard.
 * Step definitions follow stepperize pattern with id, title, and description.
 *
 * Progressive sign-up: Users create accounts with just 2 steps.
 * Identity verification (document, liveness, face match) happens
 * optionally from the dashboard after account creation.
 */
export const { Stepper, useStepper, steps, utils } = defineStepper(
  {
    id: "email",
    title: "Email",
    description: "Add your email (optional)",
  },
  {
    id: "account",
    title: "Account",
    description: "Create your secure account",
  }
);

export type StepId = (typeof steps)[number]["id"];
