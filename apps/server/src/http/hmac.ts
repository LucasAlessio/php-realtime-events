import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
	const hmac = createHmac("sha256", secret);
	hmac.update(`${timestamp}.${rawBody}`);
	return SIGNATURE_PREFIX + hmac.digest("hex");
}

export interface VerifySignatureParams {
	secret: string;
	rawBody: string;
	timestampHeader: string | undefined;
	signatureHeader: string | undefined;
	toleranceSeconds: number;
	/** Segundos desde epoch; injetável para tornar os testes determinísticos. */
	now?: number;
}

export type VerifySignatureResult =
	| { ok: true }
	| {
			ok: false;
			reason: "missing_headers" | "malformed_timestamp" | "timestamp_out_of_range" | "invalid_signature";
	  };

/**
 * Verifica `X-Signature: sha256=<hmac>` sobre `${timestamp}.${rawBody}` e
 * rejeita timestamps fora da janela de tolerância (anti-replay). A
 * comparação usa `timingSafeEqual` para não vazar informação por tempo.
 */
export function verifySignature(params: VerifySignatureParams): VerifySignatureResult {
	const { secret, rawBody, timestampHeader, signatureHeader, toleranceSeconds } = params;
	const now = params.now ?? Math.floor(Date.now() / 1000);

	if (!timestampHeader || !signatureHeader) {
		return { ok: false, reason: "missing_headers" };
	}

	const timestamp = Number(timestampHeader);
	if (!Number.isFinite(timestamp)) {
		return { ok: false, reason: "malformed_timestamp" };
	}

	if (Math.abs(now - timestamp) > toleranceSeconds) {
		return { ok: false, reason: "timestamp_out_of_range" };
	}

	const expected = Buffer.from(computeSignature(secret, timestampHeader, rawBody));
	const actual = Buffer.from(signatureHeader);

	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		return { ok: false, reason: "invalid_signature" };
	}

	return { ok: true };
}
