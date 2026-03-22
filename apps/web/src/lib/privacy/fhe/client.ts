"use client";

import { generateFheKeyMaterialForStorage as generateFheKeyMaterialForStorageImpl } from "./browser";

// Re-export for use in password sign-up flow
export const generateFheKeyMaterialForStorage =
  generateFheKeyMaterialForStorageImpl;
