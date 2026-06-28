import { google } from "googleapis";
import { db } from "./db";
import { gmailConnections, intakeMessages } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { parseIntakeEmailBody } from "./intakeParser";
import { log } from "./index";

function getOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? process.env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(state: string, redirectUri: string): string {
  const oauth2Client = getOAuthClient(redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    state,
  });
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const oauth2Client = getOAuthClient(redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export function buildRedirectUri(req: { protocol: string; hostname: string }): string {
  // In production on Replit the app runs behind a proxy; honour GOOGLE_REDIRECT_URI if set
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = process.env.REPLIT_DOMAINS ?? req.hostname;
  const proto = process.env.REPLIT_DOMAINS ? "https" : req.protocol;
  return `${proto}://${host}/api/auth/gmail/callback`;
}

async function getAuthedClient(connection: { accessToken: string; refreshToken: string; tokenExpiry: Date | null }) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiry?.getTime(),
  });
  // googleapis handles token refresh automatically when refresh_token is set
  return oauth2Client;
}

function decodeBase64(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractTextBody(payload: any): string {
  if (!payload) return "";

  // Single part text/plain
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart — walk parts looking for text/plain
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  return "";
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Decode common HTML entities and strip lines that are pure tracking URLs. */
function cleanBodyText(text: string): string {
  return text
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"').replace(/&ldquo;/g, '"')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .split('\n')
    // Drop lines that are only a URL (tracking/click links)
    .filter(line => !/^https?:\/\/\S+$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Returns true for emails we should skip (marketing, automated, social). */
function isMarketingEmail(
  headers: Array<{ name: string; value: string }>,
  labelIds: string[],
): boolean {
  if (extractHeader(headers, "list-unsubscribe")) return true;
  if (extractHeader(headers, "x-mailchimp-id")) return true;
  const promoLabels = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];
  if (labelIds.some(l => promoLabels.includes(l))) return true;
  const precedence = extractHeader(headers, "precedence").toLowerCase();
  if (precedence === "bulk" || precedence === "list") return true;
  return false;
}

/**
 * Sync one Gmail connection — fetch new messages since last historyId.
 * Returns the number of new intake messages created.
 */
export async function syncConnection(connection: {
  id: string;
  tenantId: string;
  gmailAddress: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Date | null;
  historyId: string | null;
}): Promise<number> {
  const auth = await getAuthedClient(connection);
  const gmail = google.gmail({ version: "v1", auth });

  let messageIds: string[] = [];
  let newHistoryId = connection.historyId;

  if (connection.historyId) {
    // Incremental sync: fetch history since last known point
    try {
      const historyRes = await gmail.users.history.list({
        userId: "me",
        startHistoryId: connection.historyId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
      });

      newHistoryId = historyRes.data.historyId ?? connection.historyId;

      for (const record of historyRes.data.history ?? []) {
        for (const msg of record.messagesAdded ?? []) {
          if (msg.message?.id) messageIds.push(msg.message.id);
        }
      }
    } catch (err: any) {
      // historyId too old (404) — fall back to full sweep
      if (err?.status === 404) {
        log(`[gmail] historyId expired for ${connection.gmailAddress}, doing full sweep`);
        connection = { ...connection, historyId: null };
      } else {
        throw err;
      }
    }
  }

  if (!connection.historyId) {
    // Full sweep: pull messages from the last 30 days, skip promotions/social
    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: `after:${since} in:inbox -category:promotions -category:social -category:updates`,
      maxResults: 100,
    });

    // Also capture the current historyId so future syncs are incremental
    const profileRes = await gmail.users.getProfile({ userId: "me" });
    newHistoryId = profileRes.data.historyId ?? null;

    messageIds = (listRes.data.messages ?? []).map(m => m.id!).filter(Boolean);
  }

  if (messageIds.length === 0) {
    await db
      .update(gmailConnections)
      .set({ historyId: newHistoryId ?? connection.historyId, lastSyncAt: new Date() })
      .where(eq(gmailConnections.id, connection.id));
    return 0;
  }

  // Fetch existing threadIds for this tenant to avoid duplicates
  const existing = await db
    .select({ threadId: intakeMessages.threadId })
    .from(intakeMessages)
    .where(eq(intakeMessages.tenantId, connection.tenantId));
  const existingThreadIds = new Set(existing.map(r => r.threadId).filter(Boolean));

  let created = 0;

  for (const msgId of messageIds) {
    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msgId,
        format: "full",
      });
      const msg = msgRes.data;
      const threadId = msg.threadId ?? msgId;

      // Skip if we already have a message from this thread
      if (existingThreadIds.has(threadId)) continue;
      existingThreadIds.add(threadId);

      const headers = msg.payload?.headers ?? [];
      const labelIds = msg.labelIds ?? [];

      // Skip marketing / automated / promotional emails
      if (isMarketingEmail(headers, labelIds)) continue;

      const subject = extractHeader(headers, "subject") || "(no subject)";
      const fromHeader = extractHeader(headers, "from");
      // Extract email from "Name <email>" format
      const fromMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
      const fromAddress = fromMatch ? fromMatch[1] : fromHeader;
      const rawBody = extractTextBody(msg.payload);

      if (!rawBody.trim()) continue; // skip empty messages

      const body = cleanBodyText(rawBody);
      const parsed = parseIntakeEmailBody(rawBody); // parse before cleaning to preserve structure

      await db.insert(intakeMessages).values({
        tenantId: connection.tenantId,
        channel: "email",
        threadId,
        fromAddress,
        subject,
        body,
        extractedName: parsed.name,
        extractedPhone: parsed.phone,
        extractedData: parsed.fields,
        status: "new",
      } as any);

      created++;
    } catch (err) {
      log(`[gmail] failed to fetch message ${msgId}: ${err}`);
    }
  }

  await db
    .update(gmailConnections)
    .set({ historyId: newHistoryId ?? undefined, lastSyncAt: new Date() })
    .where(eq(gmailConnections.id, connection.id));

  if (created > 0) {
    log(`[gmail] ${connection.gmailAddress}: ${created} new intake message(s) stored`);
  }

  return created;
}

/**
 * Run a sync pass over all active Gmail connections for all tenants.
 * Called by the background poller in server/index.ts.
 */
export async function syncAllActiveConnections(): Promise<void> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    log("[gmail] skipping sync — GOOGLE_CLIENT_ID/SECRET not set");
    return;
  }

  const connections = await db
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.isActive, true));

  if (connections.length === 0) {
    log("[gmail] no active connections to sync");
    return;
  }

  log(`[gmail] syncing ${connections.length} active connection(s)`);
  for (const conn of connections) {
    try {
      const created = await syncConnection(conn);
      log(`[gmail] ${conn.gmailAddress}: sync complete, ${created} new message(s)`);
    } catch (err) {
      log(`[gmail] sync error for ${conn.gmailAddress}: ${err}`);
    }
  }
}
