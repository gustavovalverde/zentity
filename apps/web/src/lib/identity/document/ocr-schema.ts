import z from "zod";

const DocumentSchema = z.object({
  documentType: z.enum([
    "passport",
    "national_id",
    "drivers_license",
    "unknown",
  ]),
  documentOrigin: z.string().optional(), // ISO 3166-1 alpha-3
  confidence: z.number().min(0).max(1),
  extractedData: z
    .object({
      fullName: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      documentNumber: z.string().optional(),
      dateOfBirth: z.string().optional(),
      expirationDate: z.string().optional(),
      nationality: z.string().optional(),
      nationalityCode: z.string().optional(),
      gender: z.string().optional(),
    })
    .optional(),
  validationIssues: z.array(z.string()),
});

export type DocumentResult = z.infer<typeof DocumentSchema>;

export const DOCUMENT_TYPE_LABELS: Record<
  DocumentResult["documentType"],
  string
> = {
  passport: "Passport",
  national_id: "National ID Card",
  drivers_license: "Driver's License",
  unknown: "Unknown Document",
};
