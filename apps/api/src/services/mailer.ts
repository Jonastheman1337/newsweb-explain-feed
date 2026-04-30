import nodemailer from "nodemailer";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config.js";

type MailPayload = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(
  config: AppConfig,
  logger: FastifyBaseLogger,
  payload: MailPayload
): Promise<void> {
  if (
    !config.SMTP_HOST ||
    !config.SMTP_PORT ||
    !config.SMTP_USER ||
    !config.SMTP_PASS ||
    !config.SMTP_FROM
  ) {
    logger.warn(
      {
        to: payload.to,
        subject: payload.subject,
        body: payload.text
      },
      "SMTP not configured. Magic link logged instead of sent."
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: payload.to,
    subject: payload.subject,
    text: payload.text
  });
}

