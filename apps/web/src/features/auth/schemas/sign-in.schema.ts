import { z } from "zod";

export const signInSchema = z.object({
  email: z.email({ message: "Please enter a valid email address" }),
  password: z.string().min(1, { message: "Password is required" }),
});

export type SignInData = z.infer<typeof signInSchema>;
