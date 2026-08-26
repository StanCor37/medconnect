import type { EmailProvider } from "../sendMail";

/**
 * Dev-only stub. Logs invitation details to the server console instead of
 * sending real email — there is no real provider wired up yet (see README).
 *
 * Segment 11 forbids logging secrets in production ("never send passwords to
 * application logs"); this provider is explicitly for local development only
 * and must never be selected via EMAIL_PROVIDER in a deployed environment.
 */
export const consoleEmailProvider: EmailProvider = {
  async sendInvitationEmail({ toEmail, firstName, tempPassword, loginUrl }) {
    console.log(
      [
        "",
        "==================== [DEV] MedConnect invitation ====================",
        `To:            ${toEmail}`,
        `Name:          ${firstName}`,
        `Login URL:     ${loginUrl}`,
        `Temp password: ${tempPassword}`,
        "Expires in 72 hours. Not a real email — EMAIL_PROVIDER=console.",
        "=======================================================================",
        "",
      ].join("\n")
    );
  },
};
