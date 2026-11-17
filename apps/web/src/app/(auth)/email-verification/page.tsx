import { EmailVerificationCard } from "../_components/email-verification-card";

interface EmailVerificationPageProps {
  searchParams: Promise<{ email?: string }>;
}

export default async function EmailVerificationPage({
  searchParams,
}: Readonly<EmailVerificationPageProps>) {
  const { email } = await searchParams;

  return <EmailVerificationCard email={email || null} />;
}
