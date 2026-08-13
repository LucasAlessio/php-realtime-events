import type { IncomingMessage, ServerResponse } from "node:http";
import type { EnvelopeBase, ParseEnvelopeError } from "@realtime-events/contracts";
import { registry } from "@realtime-events/contracts";
import { dispatchEvent } from "../core/dispatch-event.js";
import type { EventPublisher } from "../core/publisher.js";
import type { Logger } from "../logger.js";
import { verifySignature } from "./hmac.js";

export interface IngestRouteDeps {
  publisher: EventPublisher;
  logger: Logger;
  hmacSecret: string;
  timestampToleranceSeconds: number;
  maxBodyBytes: number;
}

export class BodyTooLargeError extends Error {}

function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function describeError(error: ParseEnvelopeError): string {
  switch (error.kind) {
    case "unknown_type":
      return `Unknown event type "${error.type}". Known types: ${error.knownTypes.join(", ") || "(none registered)"}`;
    case "invalid_payload":
      return `Invalid payload for event type "${error.type}": ${error.issues.map((i) => i.message).join("; ")}`;
    case "invalid_envelope":
      return `Malformed envelope: ${error.issues.map((i) => i.message).join("; ")}`;
  }
}

/**
 * Handler HTTP puro para `POST /internal/emit`. Lê o corpo cru ANTES de
 * qualquer parse de JSON — o HMAC é calculado sobre os bytes crus, não
 * sobre o objeto reserializado. Aceita um envelope único ou `{ events: [] }`
 * para lote. Validação é tudo-ou-nada: se qualquer evento do lote falhar,
 * o lote inteiro é rejeitado com 422 e a lista de erros por índice.
 */
export async function handleIngestRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: IngestRouteDeps,
): Promise<void> {
  let rawBody: string;
  try {
    rawBody = await readRawBody(req, deps.maxBodyBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(res, 413, { error: "payload_too_large" });
      return;
    }
    sendJson(res, 400, { error: "malformed_request" });
    return;
  }

  const signatureResult = verifySignature({
    secret: deps.hmacSecret,
    rawBody,
    timestampHeader: req.headers["x-timestamp"] as string | undefined,
    signatureHeader: req.headers["x-signature"] as string | undefined,
    toleranceSeconds: deps.timestampToleranceSeconds,
  });

  if (!signatureResult.ok) {
    deps.logger.warn("ingest signature rejected", { reason: signatureResult.reason });
    sendJson(res, 401, { error: "invalid_signature", reason: signatureResult.reason });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const isBatch =
    typeof parsedBody === "object" &&
    parsedBody !== null &&
    Array.isArray((parsedBody as Record<string, unknown>).events);
  const candidates: unknown[] = isBatch
    ? ((parsedBody as Record<string, unknown>).events as unknown[])
    : [parsedBody];

  const errors: Array<{ index: number; type?: string; kind: string; message: string }> = [];
  const accepted: EnvelopeBase[] = [];

  candidates.forEach((candidate, index) => {
    const result = registry.parseEnvelope(candidate);
    if (!result.ok) {
      const type =
        typeof candidate === "object" && candidate !== null
          ? ((candidate as Record<string, unknown>).type as string | undefined)
          : undefined;
      errors.push({
        index,
        ...(type !== undefined ? { type } : {}),
        kind: result.error.kind,
        message: describeError(result.error),
      });
      return;
    }
    accepted.push(result.envelope);
  });

  if (errors.length > 0) {
    deps.logger.warn("ingest validation rejected", { errors });
    sendJson(res, 422, { errors });
    return;
  }

  sendJson(res, 202, { accepted: accepted.length });

  // Responde primeiro, publica depois: o PHP não espera o fan-out do
  // Socket.IO. Falha ao publicar é logada, não propagada — best-effort.
  for (const envelope of accepted) {
    dispatchEvent(envelope, { publisher: deps.publisher, logger: deps.logger }).catch(
      (error: unknown) => {
        deps.logger.error("failed to dispatch event", {
          id: envelope.id,
          type: envelope.type,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }
}
