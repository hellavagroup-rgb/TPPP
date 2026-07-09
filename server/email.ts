import { Resend } from 'resend';
import { storage } from './storage';

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set. Email sending is unavailable.');
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

export interface TenantContext {
  id: string;
  name: string;
  fromEmail?: string | null;
}

// Used whenever there is no tenant context (or a tenant lookup fails). Must never be a
// specific tenant's name — that would leak one practice's identity into another's emails,
// or into emails that are not scoped to any practice at all.
export const GENERIC_PRACTICE_NAME = 'PsychPortal';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export function buildFromAddress(tenant?: TenantContext): string {
  if (tenant?.fromEmail) return tenant.fromEmail;
  const envFrom = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const emailMatch = envFrom.match(/<(.+)>/);
  const emailAddress = emailMatch ? emailMatch[1] : envFrom;
  const displayName = tenant?.name || GENERIC_PRACTICE_NAME;
  return `${displayName} <${emailAddress}>`;
}

function linkifyUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s<]+[^\s<.,;:'")\]])/g, url => `<a href="${url}" style="color:#667eea;word-break:break-all;">${url}</a>`);
}

function wrapInHtmlTemplate(text: string, headerTitle?: string, practiceName?: string): string {
  const footer = practiceName || GENERIC_PRACTICE_NAME;
  const lines = text.split('\n').map(line => line ? `<p>${linkifyUrls(line)}</p>` : '<br>').join('\n');
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          ${headerTitle ? `<div class="header"><h1>${headerTitle}</h1></div>` : ''}
          <div class="content">
            ${lines}
          </div>
          <div class="footer">
            <p>${footer}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function replacePlaceholders(text: string, placeholders: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

async function getStoredTemplate(templateKey: string, tenantId?: string | null): Promise<{ subject: string; bodyText: string } | null> {
  try {
    const template = await storage.getEmailTemplateByKey(templateKey, tenantId);
    return template ? { subject: template.subject, bodyText: template.bodyText } : null;
  } catch (error) {
    console.error(`Error fetching email template ${templateKey}:`, error);
    return null;
  }
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const from = options.from || buildFromAddress();
    const { data, error } = await getResend().emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }

    console.log('Email sent successfully:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============ EMAIL TEMPLATES ============

export async function generateFormInviteEmail(formName: string, formUrl: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('form_invite', tenant?.id);

  if (storedTemplate) {
    const placeholders = { form_name: formName, form_link: formUrl, practice_name: practiceName };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, practiceName, practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  return {
    to: '',
    subject: `Please Complete: ${formName} - ${practiceName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${practiceName}</h1>
            </div>
            <div class="content">
              <p>Dear Client,</p>
              <p>We have a form for you to complete as part of your intake process:</p>
              <p><strong>${formName}</strong></p>
              <p>Please click the button below to access and complete the form:</p>
              <p style="text-align: center;">
                <a href="${formUrl}" class="button">Complete Form</a>
              </p>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${formUrl}</p>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <p>Best regards,<br>${practiceName} Team</p>
            </div>
            <div class="footer">
              <p>This email was sent by ${practiceName}. Please do not reply directly to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Dear Client,\n\nPlease complete the following form: ${formName}\n\nAccess it here: ${formUrl}\n\nBest regards,\n${practiceName} Team`,
    from: buildFromAddress(tenant),
  };
}

export async function generatePasswordResetEmail(userName: string, resetUrl: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('password_reset', tenant?.id);

  if (storedTemplate) {
    const placeholders = { name: userName, reset_link: resetUrl, practice_name: practiceName };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Password Reset', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  return {
    to: '',
    subject: `Password Reset - ${practiceName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 4px; margin: 15px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset</h1>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>We received a request to reset your password. Click the button below to set a new password:</p>
              <p style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              <div class="warning">
                <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
              </div>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${resetUrl}</p>
            </div>
            <div class="footer">
              <p>${practiceName}</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${userName},\n\nWe received a request to reset your password.\n\nReset your password here: ${resetUrl}\n\nThis link will expire in 1 hour. If you didn't request this reset, please ignore this email.\n\n${practiceName}`,
    from: buildFromAddress(tenant),
  };
}

export async function generateTaskReminderEmail(assigneeName: string, taskTitle: string, taskDescription: string, dueDate: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('task_reminder', tenant?.id);

  if (storedTemplate) {
    const placeholders = {
      name: assigneeName,
      task_title: taskTitle,
      task_description: taskDescription,
      due_date: dueDate,
      practice_name: practiceName
    };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Task Reminder', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  return {
    to: '',
    subject: `Task Reminder: ${taskTitle} - Due ${dueDate}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .task-box { background: white; border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 15px 0; }
            .due-date { color: #dc3545; font-weight: bold; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Task Reminder</h1>
            </div>
            <div class="content">
              <p>Hello ${assigneeName},</p>
              <p>This is a reminder about an upcoming task:</p>
              <div class="task-box">
                <h3 style="margin-top: 0;">${taskTitle}</h3>
                <p>${taskDescription}</p>
                <p class="due-date">Due: ${dueDate}</p>
              </div>
              <p>Please log in to the practice management system to view and complete this task.</p>
            </div>
            <div class="footer">
              <p>${practiceName}</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${assigneeName},\n\nThis is a reminder about an upcoming task:\n\nTask: ${taskTitle}\nDescription: ${taskDescription}\nDue: ${dueDate}\n\nPlease log in to complete this task.\n\n${practiceName}`,
    from: buildFromAddress(tenant),
  };
}

export async function generateAvailabilityReminderEmail(clinicianName: string, loginUrl: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('availability_reminder', tenant?.id);

  if (storedTemplate) {
    const placeholders = { name: clinicianName, login_link: loginUrl, practice_name: practiceName };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Availability Update Request', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  return {
    to: '',
    subject: `Please Update Your Availability - ${practiceName}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Availability Update Request</h1>
            </div>
            <div class="content">
              <p>Hello ${clinicianName},</p>
              <p>This is a friendly reminder to update your availability in the practice management system.</p>
              <p>Keeping your availability current helps us efficiently allocate new clients and ensures accurate capacity planning.</p>
              <p style="text-align: center;">
                <a href="${loginUrl}" class="button">Update My Availability</a>
              </p>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${loginUrl}</p>
              <p>Thank you for your cooperation!</p>
              <p>Best regards,<br>${practiceName}</p>
            </div>
            <div class="footer">
              <p>${practiceName}</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${clinicianName},\n\nThis is a friendly reminder to update your availability in the practice management system.\n\nPlease log in at: ${loginUrl}\n\nKeeping your availability current helps us efficiently allocate new clients.\n\nThank you!\n${practiceName}`,
    from: buildFromAddress(tenant),
  };
}

export async function generateFormCompletionEmail(tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('form_completion', tenant?.id);

  if (storedTemplate) {
    const bodyText = replacePlaceholders(storedTemplate.bodyText, { practice_name: practiceName });
    const subject = replacePlaceholders(storedTemplate.subject, { practice_name: practiceName });
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Thank You', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  const defaultBodyText = `Thank you for completing our intake form. We know that sharing this information can sometimes feel difficult, and we really appreciate you taking the time to share it with us.

One of our senior clinicians will carefully review the information you've shared within 2-3 working days.

Once your form has been reviewed, we'll be in touch with next steps.

Warm regards,

${practiceName} Team`;

  return {
    to: '',
    subject: `Thank You for Completing Your Intake Form - ${practiceName}`,
    html: wrapInHtmlTemplate(defaultBodyText, 'Thank You', practiceName),
    text: defaultBodyText,
    from: buildFromAddress(tenant),
  };
}

export async function generateNewReferralEmail(clientDisplayId: string, clientName: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('new_referral', tenant?.id);

  if (storedTemplate) {
    const bodyText = storedTemplate.bodyText
      .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
      .replace(/\{\{clientName\}\}/g, clientName)
      .replace(/\{\{practice_name\}\}/g, practiceName);
    return {
      to: '',
      subject: storedTemplate.subject
        .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
        .replace(/\{\{practice_name\}\}/g, practiceName),
      html: wrapInHtmlTemplate(bodyText, 'New Referral', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  const bodyText = `A new client referral has been received.\n\nClient ID: ${clientDisplayId}\nName: ${clientName}\n\nPlease log in to the practice management system to review and process this referral.\n\n${practiceName}`;

  return {
    to: '',
    subject: `New Referral Received - ${clientDisplayId}`,
    html: wrapInHtmlTemplate(bodyText, 'New Referral', practiceName),
    text: bodyText,
    from: buildFromAddress(tenant),
  };
}

export async function generateWaitlistUpdateEmail(clientDisplayId: string, clientName: string, oldStatus: string, newStatus: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('waitlist_update', tenant?.id);

  if (storedTemplate) {
    const bodyText = storedTemplate.bodyText
      .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
      .replace(/\{\{clientName\}\}/g, clientName)
      .replace(/\{\{oldStatus\}\}/g, oldStatus)
      .replace(/\{\{newStatus\}\}/g, newStatus)
      .replace(/\{\{practice_name\}\}/g, practiceName);
    return {
      to: '',
      subject: storedTemplate.subject
        .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
        .replace(/\{\{practice_name\}\}/g, practiceName),
      html: wrapInHtmlTemplate(bodyText, 'Waitlist Update', practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  const bodyText = `A client's status has been updated.\n\nClient ID: ${clientDisplayId}\nName: ${clientName}\nPrevious Status: ${oldStatus}\nNew Status: ${newStatus}\n\nPlease log in to the practice management system to review this update.\n\n${practiceName}`;

  return {
    to: '',
    subject: `Client Status Updated - ${clientDisplayId}`,
    html: wrapInHtmlTemplate(bodyText, 'Waitlist Update', practiceName),
    text: bodyText,
    from: buildFromAddress(tenant),
  };
}

export async function generatePaymentLinkEmail(paymentUrl: string, amountPounds: string, tenant?: TenantContext): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('payment_link', tenant?.id);

  const subject = storedTemplate
    ? storedTemplate.subject
    : `Your Session Payment Link - ${practiceName}`;

  const rawBody = storedTemplate
    ? storedTemplate.bodyText
    : `Thank you for completing your intake process. To confirm your first therapy session, please complete your initial session payment using the secure link below.

Payment amount: £{{amount}}

Pay securely here: {{payment_url}}

Your card details will be saved securely so that future session payments can be processed automatically.

If you have any questions, please don't hesitate to contact us.

Warm regards,
${practiceName} Team`;

  const bodyText = rawBody
    .replace(/\{\{amount\}\}/g, amountPounds)
    .replace(/\{\{payment_url\}\}/g, paymentUrl)
    .replace(/\{\{practice_name\}\}/g, practiceName);

  const finalSubject = subject.replace(/\{\{practice_name\}\}/g, practiceName);

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
      .pay-button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; }
      .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>Complete Your Session Payment</h1></div>
      <div class="content">
        <p>${bodyText.replace(/\n/g, '<br>')}</p>
        <p style="text-align:center;"><a href="${paymentUrl}" class="pay-button">Pay Securely Now</a></p>
      </div>
      <div class="footer">${practiceName}</div>
    </div>
  </body>
</html>`;

  return { to: '', subject: finalSubject, html, text: bodyText, from: buildFromAddress(tenant) };
}

export async function generateClinicianWelcomeEmail(
  userName: string,
  userEmail: string,
  tempPassword: string,
  tenant?: TenantContext
): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('clinician_welcome', tenant?.id);

  if (storedTemplate) {
    const placeholders = { name: userName, email: userEmail, temporary_password: tempPassword, practice_name: practiceName };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, `Welcome to ${practiceName}`, practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  const bodyText = `Hello ${userName},\n\nYour login credentials have been generated. Here are your details:\n\nEmail: ${userEmail}\nTemporary Password: ${tempPassword}\n\nPlease log in and change your password as soon as possible.\n\nBest regards,\n${practiceName} Team`;
  return {
    to: '',
    subject: `Your Login Credentials - ${practiceName}`,
    html: wrapInHtmlTemplate(bodyText, `Welcome to ${practiceName}`, practiceName),
    text: bodyText,
    from: buildFromAddress(tenant),
  };
}

export async function generateAdminInviteEmail(
  userName: string,
  inviteUrl: string,
  tenant?: TenantContext
): Promise<EmailOptions> {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const storedTemplate = await getStoredTemplate('admin_invite', tenant?.id);

  if (storedTemplate) {
    const placeholders = { name: userName, invite_link: inviteUrl, practice_name: practiceName };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, `Invitation \u2013 ${practiceName}`, practiceName),
      text: bodyText,
      from: buildFromAddress(tenant),
    };
  }

  const bodyText = `Hello ${userName},\n\nYou have been invited to join ${practiceName} as an administrator.\n\nPlease click the link below to set up your password and activate your account:\n${inviteUrl}\n\nThis link will expire in 7 days.\n\nBest regards,\n${practiceName}`;
  return {
    to: '',
    subject: `You've been invited as an Admin - ${practiceName}`,
    html: wrapInHtmlTemplate(bodyText, `Invitation \u2013 ${practiceName}`, practiceName),
    text: bodyText,
    from: buildFromAddress(tenant),
  };
}

export async function getFormCompletionPageContent(
  tenantId: string | null | undefined,
  practiceName: string
): Promise<{ heading: string; body: string }> {
  const storedTemplate = await getStoredTemplate('form_completion_page', tenantId);
  const defaultHeading = 'Thank you for completing our intake form.';
  const defaultBody = [
    'A senior clinician will review your responses within 2\u20133 working days. This helps us understand your needs, consider any preferences or adjustments, and suggest the most suitable Psychologist for you.',
    'We will be in touch soon with next steps.',
    "If you have any questions in the meantime, please get in touch with us directly using the contact details we've previously provided you.",
    'If you need urgent support, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123 lines open 24/7 365 days a year or email jo@samaritans.org); or contact CALM (https://www.thecalmzone.net/) on their national helpline 0800 585858 (5pm to midnight).',
    'Warm regards,',
    '{{practice_name}} Team',
  ].join('\n\n');

  if (storedTemplate) {
    return {
      heading: replacePlaceholders(storedTemplate.subject, { practice_name: practiceName }),
      body: replacePlaceholders(storedTemplate.bodyText, { practice_name: practiceName }),
    };
  }

  return {
    heading: defaultHeading,
    body: replacePlaceholders(defaultBody, { practice_name: practiceName }),
  };
}

export function generatePaymentFailureEmail(clientDisplayId: string, clientName: string, amountPounds: string, failureReason: string, tenant?: TenantContext): EmailOptions {
  const practiceName = tenant?.name || GENERIC_PRACTICE_NAME;
  const subject = `Payment Failed – ${clientDisplayId}`;
  const bodyText = `A payment has failed for a client.\n\nClient ID: ${clientDisplayId}\nClient Name: ${clientName}\nAmount: £${amountPounds}\nReason: ${failureReason}\n\nPlease log in to the practice management system to review this client's payment status and take action if required.\n\n${practiceName}`;
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
      .detail-row { margin: 8px 0; }
      .label { font-weight: bold; }
      .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header"><h1>Payment Failed</h1></div>
      <div class="content">
        <p>A payment has failed for a client and may require your attention.</p>
        <div class="detail-row"><span class="label">Client ID:</span> ${clientDisplayId}</div>
        <div class="detail-row"><span class="label">Client Name:</span> ${clientName}</div>
        <div class="detail-row"><span class="label">Amount:</span> £${amountPounds}</div>
        <div class="detail-row"><span class="label">Failure Reason:</span> ${failureReason}</div>
        <p>Please log in to the practice management system to review this client's payment status and take action if required.</p>
      </div>
      <div class="footer">${practiceName}</div>
    </div>
  </body>
</html>`;
  return { to: '', subject, html, text: bodyText, from: buildFromAddress(tenant) };
}
