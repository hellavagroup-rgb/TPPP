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

// From address - defaults to Resend sandbox for testing, should be set to verified domain in production
const FROM_EMAIL = process.env.FROM_EMAIL || 'The Perinatal Psychology Practice <onboarding@resend.dev>';

// Helper to wrap plain text in HTML email template
function wrapInHtmlTemplate(text: string, headerTitle?: string): string {
  const lines = text.split('\n').map(line => line ? `<p>${line}</p>` : '<br>').join('\n');
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
            <p>The Perinatal Psychology Practice</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

// Helper to replace placeholders in template text
function replacePlaceholders(text: string, placeholders: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// Async helper to get template from DB or return null
async function getStoredTemplate(templateKey: string): Promise<{ subject: string; bodyText: string } | null> {
  try {
    const template = await storage.getEmailTemplateByKey(templateKey);
    return template ? { subject: template.subject, bodyText: template.bodyText } : null;
  } catch (error) {
    console.error(`Error fetching email template ${templateKey}:`, error);
    return null;
  }
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_EMAIL,
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

export async function generateFormInviteEmail(formName: string, formUrl: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('form_invite');
  
  if (storedTemplate) {
    const placeholders = { form_name: formName, form_link: formUrl };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'The Perinatal Psychology Practice'),
      text: bodyText,
    };
  }

  return {
    to: '', // Will be set by caller
    subject: `Please Complete: ${formName} - The Perinatal Psychology Practice`,
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
              <h1>The Perinatal Psychology Practice</h1>
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
              <p>Best regards,<br>The Perinatal Psychology Practice Team</p>
            </div>
            <div class="footer">
              <p>This email was sent by The Perinatal Psychology Practice. Please do not reply directly to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Dear Client,\n\nPlease complete the following form: ${formName}\n\nAccess it here: ${formUrl}\n\nBest regards,\nThe Perinatal Psychology Practice Team`,
  };
}

export async function generatePasswordResetEmail(userName: string, resetUrl: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('password_reset');
  
  if (storedTemplate) {
    const placeholders = { name: userName, reset_link: resetUrl };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Password Reset'),
      text: bodyText,
    };
  }

  return {
    to: '', // Will be set by caller
    subject: 'Password Reset - The Perinatal Psychology Practice',
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
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${userName},\n\nWe received a request to reset your password.\n\nReset your password here: ${resetUrl}\n\nThis link will expire in 1 hour. If you didn't request this reset, please ignore this email.\n\nThe Perinatal Psychology Practice`,
  };
}

export async function generateTaskReminderEmail(assigneeName: string, taskTitle: string, taskDescription: string, dueDate: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('task_reminder');
  
  if (storedTemplate) {
    const placeholders = { 
      name: assigneeName, 
      task_title: taskTitle, 
      task_description: taskDescription, 
      due_date: dueDate 
    };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Task Reminder'),
      text: bodyText,
    };
  }

  return {
    to: '', // Will be set by caller
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
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${assigneeName},\n\nThis is a reminder about an upcoming task:\n\nTask: ${taskTitle}\nDescription: ${taskDescription}\nDue: ${dueDate}\n\nPlease log in to complete this task.\n\nThe Perinatal Psychology Practice`,
  };
}

export async function generateAvailabilityReminderEmail(clinicianName: string, loginUrl: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('availability_reminder');
  
  if (storedTemplate) {
    const placeholders = { name: clinicianName, login_link: loginUrl };
    const bodyText = replacePlaceholders(storedTemplate.bodyText, placeholders);
    const subject = replacePlaceholders(storedTemplate.subject, placeholders);
    return {
      to: '',
      subject,
      html: wrapInHtmlTemplate(bodyText, 'Availability Update Request'),
      text: bodyText,
    };
  }

  return {
    to: '',
    subject: `Please Update Your Availability - The Perinatal Psychology Practice`,
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
              <p>Best regards,<br>The Perinatal Psychology Practice</p>
            </div>
            <div class="footer">
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${clinicianName},\n\nThis is a friendly reminder to update your availability in the practice management system.\n\nPlease log in at: ${loginUrl}\n\nKeeping your availability current helps us efficiently allocate new clients.\n\nThank you!\nThe Perinatal Psychology Practice`,
  };
}

export async function generateFormCompletionEmail(): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('form_completion');
  
  if (storedTemplate) {
    return {
      to: '',
      subject: storedTemplate.subject,
      html: wrapInHtmlTemplate(storedTemplate.bodyText, 'Thank You'),
      text: storedTemplate.bodyText,
    };
  }

  const defaultBodyText = `Thank you for completing our intake form. We know that sharing this information can sometimes feel difficult, and we really appreciate you taking the time to share it with us.

One of our senior clinicians will carefully review the information you've shared within 2-3 working days. Your form helps us to:

Better understand what you are experiencing and what support you might need

Take into account any preferences or adjustments that would help you feel comfortable in therapy

Recommend a Clinical or Counselling Psychologist whose experience and availability best fits what you're looking for

All of our clinicians are HCPC registered Psychologists with specialist expertise in perinatal mental health, and we take care to make thoughtful, individualised recommendations.

Once your form has been reviewed, we'll be in touch with next steps.

If you have any questions in the meantime, please don't hesitate to contact us at pa@perinatalpsychologypractice.co.uk.

Warm regards,

The Perinatal Psychology Practice Team


If you need urgent support, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123 lines open 24/7 365 days a year or email jo@samaritans.org); or contact CALM (https://www.thecalmzone.net/) on their national helpline 0800 585858 (5pm to midnight).`;

  return {
    to: '',
    subject: 'Thank You for Completing Your Intake Form - The Perinatal Psychology Practice',
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
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            .urgent-support { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Thank You</h1>
            </div>
            <div class="content">
              <p>Thank you for completing our intake form. We know that sharing this information can sometimes feel difficult, and we really appreciate you taking the time to share it with us.</p>
              
              <p>One of our senior clinicians will carefully review the information you've shared within 2-3 working days. Your form helps us to:</p>
              
              <ul>
                <li>Better understand what you are experiencing and what support you might need</li>
                <li>Take into account any preferences or adjustments that would help you feel comfortable in therapy</li>
                <li>Recommend a Clinical or Counselling Psychologist whose experience and availability best fits what you're looking for</li>
              </ul>
              
              <p>All of our clinicians are HCPC registered Psychologists with specialist expertise in perinatal mental health, and we take care to make thoughtful, individualised recommendations.</p>
              
              <p>Once your form has been reviewed, we'll be in touch with next steps.</p>
              
              <p>If you have any questions in the meantime, please don't hesitate to contact us at <a href="mailto:pa@perinatalpsychologypractice.co.uk">pa@perinatalpsychologypractice.co.uk</a>.</p>
              
              <p>Warm regards,</p>
              <p><strong>The Perinatal Psychology Practice Team</strong></p>
              
              <div class="urgent-support">
                <strong>If you need urgent support</strong>, please contact your GP or a trusted healthcare provider. In the UK, you can also receive immediate support from: the Samaritans (Call 116 123, lines open 24/7 365 days a year, or email <a href="mailto:jo@samaritans.org">jo@samaritans.org</a>); or contact CALM (<a href="https://www.thecalmzone.net/">https://www.thecalmzone.net/</a>) on their national helpline 0800 585858 (5pm to midnight).
              </div>
            </div>
            <div class="footer">
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: defaultBodyText,
  };
}

export async function generateNewReferralEmail(clientDisplayId: string, clientName: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('new_referral');
  
  if (storedTemplate) {
    const bodyText = storedTemplate.bodyText
      .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
      .replace(/\{\{clientName\}\}/g, clientName);
    return {
      to: '',
      subject: storedTemplate.subject.replace(/\{\{clientDisplayId\}\}/g, clientDisplayId),
      html: wrapInHtmlTemplate(bodyText, 'New Referral'),
      text: bodyText,
    };
  }

  const bodyText = `A new client referral has been received.\n\nClient ID: ${clientDisplayId}\nName: ${clientName}\n\nPlease log in to the practice management system to review and process this referral.\n\nThe Perinatal Psychology Practice`;

  return {
    to: '',
    subject: `New Referral Received - ${clientDisplayId}`,
    html: wrapInHtmlTemplate(bodyText, 'New Referral'),
    text: bodyText,
  };
}

export async function generateWaitlistUpdateEmail(clientDisplayId: string, clientName: string, oldStatus: string, newStatus: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('waitlist_update');
  
  if (storedTemplate) {
    const bodyText = storedTemplate.bodyText
      .replace(/\{\{clientDisplayId\}\}/g, clientDisplayId)
      .replace(/\{\{clientName\}\}/g, clientName)
      .replace(/\{\{oldStatus\}\}/g, oldStatus)
      .replace(/\{\{newStatus\}\}/g, newStatus);
    return {
      to: '',
      subject: storedTemplate.subject.replace(/\{\{clientDisplayId\}\}/g, clientDisplayId),
      html: wrapInHtmlTemplate(bodyText, 'Waitlist Update'),
      text: bodyText,
    };
  }

  const bodyText = `A client's status has been updated.\n\nClient ID: ${clientDisplayId}\nName: ${clientName}\nPrevious Status: ${oldStatus}\nNew Status: ${newStatus}\n\nPlease log in to the practice management system to review this update.\n\nThe Perinatal Psychology Practice`;

  return {
    to: '',
    subject: `Client Status Updated - ${clientDisplayId}`,
    html: wrapInHtmlTemplate(bodyText, 'Waitlist Update'),
    text: bodyText,
  };
}

export async function generatePaymentLinkEmail(paymentUrl: string, amountPounds: string): Promise<EmailOptions> {
  const storedTemplate = await getStoredTemplate('payment_link');

  const subject = storedTemplate
    ? storedTemplate.subject
    : 'Your Session Payment Link - The Perinatal Psychology Practice';

  const rawBody = storedTemplate
    ? storedTemplate.bodyText
    : `Thank you for completing your intake process. To confirm your first therapy session, please complete your initial session payment using the secure link below.

Payment amount: £{{amount}}

Pay securely here: {{payment_url}}

Your card details will be saved securely so that future session payments can be processed automatically.

If you have any questions, please don't hesitate to contact us.

Warm regards,
The Perinatal Psychology Practice Team`;

  const bodyText = rawBody
    .replace(/\{\{amount\}\}/g, amountPounds)
    .replace(/\{\{payment_url\}\}/g, paymentUrl);

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
      <div class="footer">The Perinatal Psychology Practice</div>
    </div>
  </body>
</html>`;

  return { to: '', subject, html, text: bodyText };
}

export function generatePaymentFailureEmail(clientDisplayId: string, clientName: string, amountPounds: string, failureReason: string): EmailOptions {
  const subject = `Payment Failed – ${clientDisplayId}`;
  const bodyText = `A payment has failed for a client.\n\nClient ID: ${clientDisplayId}\nClient Name: ${clientName}\nAmount: £${amountPounds}\nReason: ${failureReason}\n\nPlease log in to the practice management system to review this client's payment status and take action if required.\n\nThe Perinatal Psychology Practice`;
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
      <div class="footer">The Perinatal Psychology Practice</div>
    </div>
  </body>
</html>`;
  return { to: '', subject, html, text: bodyText };
}
