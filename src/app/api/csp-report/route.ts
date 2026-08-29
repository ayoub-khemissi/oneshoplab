import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sink for Content-Security-Policy-Report-Only violations (see
 * next.config.ts). Logged to stdout (PM2 captures it) so the policy can be
 * tuned from real traffic before it is ever enforced. Body is capped and
 * never persisted — it is untrusted browser input.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const text = (await req.text()).slice(0, 4_000);
    const json = JSON.parse(text) as Record<string, unknown>;
    const r = (json['csp-report'] ?? json.body ?? json) as Record<string, unknown>;
    console.warn(
      '[csp-report]',
      JSON.stringify({
        directive: r['violated-directive'] ?? r['effectiveDirective'],
        blocked: r['blocked-uri'] ?? r['blockedURL'],
        page: r['document-uri'] ?? r['documentURL'],
        sample: r['script-sample'] ?? r['sample']
      })
    );
  } catch {
    /* malformed report — ignore */
  }
  return new NextResponse(null, { status: 204 });
}
