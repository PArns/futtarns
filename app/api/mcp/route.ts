import { getDb } from '@/lib/db';
import { handleMcpRequest } from '@/lib/services/mcp';

export const dynamic = 'force-dynamic';

/**
 * The MCP endpoint (Streamable HTTP, without sessions): every JSON-RPC message comes as a
 * POST with a member's key and gets its answer as JSON. See `lib/services/mcp.ts`.
 */
export async function POST(request: Request) {
  return handleMcpRequest(await getDb(), request);
}

/** No server-sent events and no sessions: there is nothing to stream or end. */
function notAllowed() {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

export const GET = notAllowed;
export const DELETE = notAllowed;
