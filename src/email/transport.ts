import type { EmailStatusDto } from '@sr/shared'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../lib/env'

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}
export interface Mailer { send(m: MailMessage): Promise<void> }

const fromAddress = () => env.SR_SMTP_FROM ?? env.SR_SMTP_USER ?? null

/** Never exposes credentials. */
export function smtpStatus(): EmailStatusDto {
  return { configured: !!env.SR_SMTP_HOST, host: env.SR_SMTP_HOST ?? null, from: fromAddress() }
}

let transporter: Transporter | null = null

/** One shared transport; null when SMTP is not configured. */
export function getMailer(): Mailer | null {
  if (!env.SR_SMTP_HOST) return null
  transporter ??= nodemailer.createTransport({
    host: env.SR_SMTP_HOST,
    port: env.SR_SMTP_PORT,
    secure: env.SR_SMTP_SECURE,
    auth: env.SR_SMTP_USER ? { user: env.SR_SMTP_USER, pass: env.SR_SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  })
  const t = transporter
  return { send: async (m) => { await t.sendMail({ from: fromAddress() ?? undefined, ...m }) } }
}
