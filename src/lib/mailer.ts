// Dev mailer: no email provider is configured yet, so "sending" logs the link
// to the server console. Swap the implementation for a real provider (kept
// behind this interface) without touching callers.

interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export const mailer = {
  send(message: MailMessage): Promise<void> {
    console.log('--- MAIL (dev transport) ---');
    console.log(`To:      ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(message.text);
    console.log('----------------------------');
    return Promise.resolve();
  },
};
