/**
 * Tables Turned — Cloudflare Worker API Proxy
 *
 * Sits between the browser and Anthropic's API.
 * Holds the API key as a secret so users never need their own.
 * Supports both regular and streaming requests.
 *
 * Abuse limits (the key is never returned to callers, but calls cost money):
 *   - per-IP rate limit via the RATE_LIMITER binding (wrangler.toml)
 *   - only ALLOWED_MODELS, and max_tokens <= MAX_OUTPUT_TOKENS
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

/**
 * Build CORS headers for the response.
 * allowedOrigins is a comma-separated string of allowed origins,
 * e.g. "https://turned-tables.pages.dev,https://tables-turned.com"
 */
function jsonError(message, status, cors, extraHeaders = {}) {
  // { error: { message } } is the shape synthesis.js shows to the user.
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function corsHeaders(origin, allowedOrigins) {
  const origins = allowedOrigins.split(',').map(o => o.trim());

  const allowed = (
    origins.includes(origin) ||
    origin?.startsWith('http://localhost') ||
    origin?.startsWith('http://127.0.0.1')
  );

  return {
    'Access-Control-Allow-Origin': allowed ? origin : origins[0],
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

    // Per-IP rate limit (skipped only if the binding is missing, e.g. an old local setup)
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return jsonError('Too many requests from your connection. Please wait a minute and try again.', 429, cors, { 'Retry-After': '60' });
      }
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

      // Only forward what the site itself sends
      const allowedModels = (env.ALLOWED_MODELS || 'claude-opus-4-6').split(',').map(m => m.trim());
      const maxTokens = parseInt(env.MAX_OUTPUT_TOKENS || '2048', 10);
      if (!allowedModels.includes(body.model)) {
        return jsonError('Model not allowed', 400, cors);
      }
      if (typeof body.max_tokens !== 'number' || body.max_tokens > maxTokens) {
        return jsonError(`max_tokens must be a number no greater than ${maxTokens}`, 400, cors);
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
