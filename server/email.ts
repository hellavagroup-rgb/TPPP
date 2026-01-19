import { Resend } from 'resend';
import { storage } from './storage';

const resend = new Resend(process.env.RESEND_API_KEY);

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
    const { data, error } = await resend.emails.send({
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
