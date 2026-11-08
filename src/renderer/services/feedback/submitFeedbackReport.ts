import type { FeedbackDiagnosticsContextInput } from '@/common/types/feedbackDiagnostics';
import { httpRequest } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';

const SUMMARY_PREVIEW_LENGTH = 60;
const LOG_PREFIX = '[FeedbackReport]';
type FeedbackLogLevel = 'info' | 'warn' | 'error';
type FeedbackLogAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDbDiagnosticsAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDiagnosticsAttachmentPayload = {
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
  filename: string;
};

export type FeedbackAttachment = {
  filename: string;
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type FeedbackEventTags = Record<string, string>;
export type FeedbackEventExtra = Record<string, unknown>;

export type SubmitFeedbackReportInput = {
  attachments?: FeedbackAttachment[];
  collectDbDiagnostics?: FeedbackDiagnosticsContextInput;
  collectLogs?: boolean;
  contactEmail?: string;
  description: string;
  extra?: FeedbackEventExtra;
  flushTimeoutMs?: number;
  module: string;
  moduleLabel: string;
  tags?: FeedbackEventTags;
};

function summarizeAttachments(attachments: FeedbackAttachment[]): Array<{
  contentType: string;
  filename: string;
  size: number;
}> {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.data.byteLength,
  }));
}

function summarizeLogAttachment(
  status: FeedbackLogAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackLogAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function summarizeDbDiagnosticsAttachment(
  status: FeedbackDbDiagnosticsAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackDbDiagnosticsAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function normalizeLogDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }
  return details;
}

export function logFeedbackReport(level: FeedbackLogLevel, message: string, details?: unknown): void {
  const normalizedDetails = normalizeLogDetails(details);
  const consoleMessage = `${LOG_PREFIX} ${message}`;
  if (level === 'error') {
    console.error(consoleMessage, normalizedDetails);
  } else if (level === 'warn') {
    console.warn(consoleMessage, normalizedDetails);
  } else {
    console.info(consoleMessage, normalizedDetails);
  }

  try {
    window.electronAPI?.logFeedbackEvent?.({
      level,
      message,
      details: normalizedDetails,
    });
  } catch {
    // Renderer console logging above is the fallback.
  }
}

async function collectLogAttachment(): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackLogAttachmentStatus;
}> {
  try {
    const electronAPI = typeof window === 'undefined' ? undefined : window.electronAPI;
    if (!electronAPI?.collectFeedbackLogs) {
      return { attachment: null, status: 'unavailable' };
    }

    const logData = await electronAPI?.collectFeedbackLogs?.();
    if (!logData) {
      return { attachment: null, status: 'empty' };
    }

    return {
      attachment: {
        filename: logData.filename,
        data: new Uint8Array(logData.data),
        contentType: 'application/gzip',
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

async function collectDbDiagnosticsAttachment(request: FeedbackDiagnosticsContextInput): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackDbDiagnosticsAttachmentStatus;
}> {
  try {
    if (typeof fetch === 'undefined') {
      return { attachment: null, status: 'unavailable' };
    }

    const diagnostics = await httpRequest<unknown>('GET', buildFeedbackDiagnosticsPath(request), undefined, {
      silentStatuses: [400, 401, 403, 404, 500, 502, 503, 504],
    });
    if (!diagnostics) {
      return { attachment: null, status: 'empty' };
    }
    const payload = await encodeDiagnosticsAttachmentPayload(diagnostics);

    return {
      attachment: {
        filename: payload.filename,
        data: payload.data,
        contentType: payload.contentType,
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

function buildFeedbackDiagnosticsPath(request: FeedbackDiagnosticsContextInput): string {
  const params = new URLSearchParams();
  appendQueryParam(params, 'route_at_open', request.routeAtOpen);
  appendQueryParam(params, 'route_at_submit', request.routeAtSubmit);
  appendQueryParam(params, 'selected_module', request.selectedModule);
  appendQueryParam(params, 'profiles', request.explicitProfiles?.join(','));
  appendQueryParam(params, 'conversation_id', request.explicitContext?.conversationId);
  appendQueryParam(params, 'provider_id', request.explicitContext?.providerId);
  appendQueryParam(params, 'agent_id', request.explicitContext?.agentId);
  appendQueryParam(params, 'team_id', request.explicitContext?.teamId);
  appendQueryParam(params, 'mcp_server_id', request.explicitContext?.mcpServerId);

  const query = params.toString();
  return query ? `/api/system/diagnostics/feedback-report?${query}` : '/api/system/diagnostics/feedback-report';
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}

async function encodeDiagnosticsAttachmentPayload(value: unknown): Promise<FeedbackDiagnosticsAttachmentPayload> {
  const data = new TextEncoder().encode(JSON.stringify(value, null, 2));
  try {
    if (typeof CompressionStream !== 'function') {
      return {
        filename: 'db-diagnostics.json',
        data,
        contentType: 'application/json',
      };
    }

    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return {
      filename: 'db-diagnostics.json.gz',
      data: compressed,
      contentType: 'application/gzip',
    };
  } catch {
    return {
      filename: 'db-diagnostics.json',
      data,
      contentType: 'application/json',
    };
  }
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ');
}

function buildSummary(moduleLabel: string, description: string): string {
  const summaryPreview =
    description.length > SUMMARY_PREVIEW_LENGTH
      ? `${description.slice(0, SUMMARY_PREVIEW_LENGTH).trimEnd()}...`
      : description;
  return `${moduleLabel}: ${summaryPreview}`;
}

export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<void> {
  const attachments = [...(input.attachments ?? [])];
  let logAttachmentStatus: FeedbackLogAttachmentStatus = input.collectLogs ? 'empty' : 'skipped';
  let logAttachment: FeedbackAttachment | null = null;
  let dbDiagnosticsAttachmentStatus: FeedbackDbDiagnosticsAttachmentStatus = input.collectDbDiagnostics
    ? 'empty'
    : 'skipped';
  let dbDiagnosticsAttachment: FeedbackAttachment | null = null;

  try {
    if (input.collectLogs) {
      const collectedLogAttachment = await collectLogAttachment();
      logAttachmentStatus = collectedLogAttachment.status;
      logAttachment = collectedLogAttachment.attachment;
      if (logAttachment) {
        attachments.unshift(logAttachment);
      }
    }

    if (input.collectDbDiagnostics) {
      const collectedDbDiagnosticsAttachment = await collectDbDiagnosticsAttachment(input.collectDbDiagnostics);
      dbDiagnosticsAttachmentStatus = collectedDbDiagnosticsAttachment.status;
      dbDiagnosticsAttachment = collectedDbDiagnosticsAttachment.attachment;
      if (dbDiagnosticsAttachment) {
        attachments.unshift(dbDiagnosticsAttachment);
      }
    }

    const normalizedDescription = normalizeDescription(input.description);
    const eventSummary = buildSummary(input.moduleLabel, normalizedDescription);
    const contactEmail = input.contactEmail?.trim();

    // Tauri build: @sentry/electron is unavailable, so reports are delivered
    // as a pre-filled GitHub issue instead of a Sentry event. Screenshots and
    // log attachments cannot travel through a URL, so they are left on the
    // clipboard/临时目录 when present and the issue body tells the reporter
    // how to attach them.
    const issueTitle = encodeURIComponent(`[feedback] ${eventSummary}`);
    const issueLines = [
      '## Feedback',
      '',
      `**Module**: ${input.moduleLabel} (${input.module})`,
      '',
      '### Description',
      '',
      normalizedDescription,
      '',
      '### Environment',
      '',
      `- App: Aibaton ${(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ ?? 'unknown'} (Tauri desktop)`,
      `- Platform: ${navigator.platform || 'unknown'}`,
      `- Submitted at: ${new Date().toISOString()}`,
      contactEmail ? `- Contact: ${contactEmail}` : null,
      '',
      input.tags && Object.keys(input.tags).length
        ? `### Tags\n\n${Object.entries(input.tags)
            .filter(([, v]) => String(v).trim())
            .map(([k, v]) => `- ${k}: ${v}`)
            .join('\n')}`
        : null,
      attachments.length
        ? `### Attachments\n\n${attachments.length} attachment(s) were collected but cannot be sent through this link — please paste screenshots into the issue and attach log files manually.\`
  (logs: ${logAttachmentStatus}, db diagnostics: ${dbDiagnosticsAttachmentStatus})\``
        : null,
    ].filter(Boolean);
    const issueBody = encodeURIComponent(issueLines.join('\n'));
    const repo = 'iOfficeAI/AionUi';
    const issueUrl = `https://github.com/${repo}/issues/new?title=${issueTitle}&body=${issueBody.slice(0, 6000)}`;

    try {
      await ipcBridge.shell.openExternal.invoke(issueUrl);
    } catch (err) {
      throw new Error(`Failed to open the browser for the feedback issue: ${String(err)}`);
    }
    // Copy the description so the reporter can paste it into the issue even
    // if the pre-fill was truncated by the URL length limit.
    void navigator.clipboard?.writeText(`${eventSummary}\n\n${normalizedDescription}`).catch(() => undefined);

    logFeedbackReport('info', 'submitted', {
      module: input.module,
      issueUrl,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      tagKeys: Object.keys(input.tags ?? {}),
    });
  } catch (error) {
    logFeedbackReport('error', 'failed', {
      module: input.module,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      flushTimeoutMs: input.flushTimeoutMs,
      error,
    });
    throw error;
  }
}
