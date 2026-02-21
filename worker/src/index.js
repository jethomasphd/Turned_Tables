/**
 * Tables Turned — Cloudflare Worker API Proxy
 *
 * Sits between the browser and Anthropic's API.
 * Holds the API key as a secret so users never need their own.
 * Supports both regular and streaming requests.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

/**
 * Build CORS headers for the response.
 */
function corsHeaders(origin, allowedOrigin) {
  // In development, allow localhost. In production, lock to your domain.
  const allowed = (
    origin === allowedOrigin ||
    origin?.startsWith('http://localhost') ||
    origin?.startsWith('http://127.0.0.1')
  );

  return {
    'Access-Control-Allow-Origin': allowed ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Verify the API key secret is configured
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'API key not configured on worker' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Parse the incoming request body
      const body = await request.json();

      // Basic validation: must have model and messages
      if (!body.model || !body.messages) {
        return new Response(JSON.stringify({ error: 'Request must include model and messages' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const isStreaming = body.stream === true;

      // Forward to Anthropic
      const anthropicResponse = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      // For streaming responses, pipe the stream through
      if (isStreaming && anthropicResponse.ok) {
        return new Response(anthropicResponse.body, {
          status: anthropicResponse.status,
          headers: {
            ...cors,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      // For non-streaming or error responses, forward as JSON
      const responseBody = await anthropicResponse.text();
      return new Response(responseBody, {
        status: anthropicResponse.status,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Worker error' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
