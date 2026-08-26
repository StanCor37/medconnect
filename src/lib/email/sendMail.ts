export interface InvitationEmailInput {
  toEmail: string;
  firstName: string;
  tempPassword: string;
  loginUrl: string;
}

export interface EmailProvider {
  sendInvitationEmail(input: InvitationEmailInput): Promise<void>;
}

import { consoleEmailProvider } from "./providers/console";

const providers: Record<string, EmailProvider> = {
  console: consoleEmailProvider,
};

export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? "console";
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown EMAIL_PROVIDER "${name}"`);
  }
  return provider;
}
