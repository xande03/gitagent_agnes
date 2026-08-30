import { z } from "zod";

import { runAgentStream } from "./agent.server";

const repoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  token: z.string().min(1),
});

const attachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  isImage: z.boolean(),
  dataBase64: z.string(),
  text: z.string().optional(),
});

const chatSchema = z.object({
  repo: repoSchema,
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  attachments: z.array(attachmentSchema).default([]),
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // clientes non-browser
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Endpoint SSE (POST /api/agent-stream): valida o payload, roda o agente em
 * modo streaming e encaminha eventos { delta | step | commit | done | error }
 * para o cliente enquanto o modelo gera a resposta.
 */
export async function handleAgentStreamRequest(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "Origem não permitida.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Corpo da requisição inválido.");
  }
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Dados inválidos para o agente.");

  const controller = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(sc) {
      const send = (type: string, data: Record<string, unknown>) => {
        if (closed) return;
        try {
          sc.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
        } catch {
          // Cliente desconectou no meio do stream → aborta o trabalho do agente.
          closed = true;
          controller.abort();
        }
      };
      try {
        await runAgentStream(parsed.data, send, controller.signal);
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Erro inesperado no agente.",
        });
      } finally {
        closed = true;
        try {
          sc.close();
        } catch {
          // stream já encerrado
        }
      }
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
