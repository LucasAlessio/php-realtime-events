import { describe, expect, it } from "vitest";
import { decodeJwtSecret, loadConfig } from "./config.js";

const baseEnv = {
	INGEST_HMAC_SECRET: "ingest-hmac-secret-value",
};

describe("decodeJwtSecret", () => {
	it("decodes a base64 (standard alphabet, padded) secret to its raw bytes", () => {
		const bytes = Buffer.from("a secret that is 22+ bytes long");
		const base64 = bytes.toString("base64");

		expect(decodeJwtSecret(base64, "base64")).toEqual(bytes);
	});

	it("decodes a base64url (unpadded) secret to its raw bytes", () => {
		const bytes = Buffer.from("a secret that is 22+ bytes long");
		const base64url = bytes.toString("base64url");

		expect(decodeJwtSecret(base64url, "base64")).toEqual(bytes);
	});

	it("treats the value as raw UTF-8 bytes under the utf8 encoding", () => {
		expect(decodeJwtSecret("plain-text-secret-value", "utf8")).toEqual(
			new TextEncoder().encode("plain-text-secret-value"),
		);
	});

	it("rejects a value that isn't valid base64 when encoding is base64", () => {
		expect(() => decodeJwtSecret("not base64! has spaces and punctuation!!", "base64")).toThrow(
			/not valid base64/,
		);
	});
});

describe("loadConfig JWT_SECRET handling", () => {
	it("defaults JWT_SECRET_ENCODING to base64 when unset", () => {
		const secretBytes = Buffer.from("a secret that is 22+ bytes long");
		const config = loadConfig({
			...baseEnv,
			JWT_SECRET: secretBytes.toString("base64url"),
		});

		expect(config.JWT_SECRET_ENCODING).toBe("base64");
		expect(config.JWT_KEY).toEqual(secretBytes);
	});

	it("decodes JWT_SECRET as base64 and exposes JWT_KEY", () => {
		const secretBytes = Buffer.from("a secret that is 22+ bytes long");
		const config = loadConfig({
			...baseEnv,
			JWT_SECRET: secretBytes.toString("base64url"),
			JWT_SECRET_ENCODING: "base64",
		});

		expect(config.JWT_KEY).toEqual(secretBytes);
	});

	it("treats JWT_SECRET as plain text under utf8 encoding", () => {
		const secret = "a-plain-text-secret-value";
		const config = loadConfig({
			...baseEnv,
			JWT_SECRET: secret,
			JWT_SECRET_ENCODING: "utf8",
		});

		expect(config.JWT_KEY).toEqual(new TextEncoder().encode(secret));
	});

	it("rejects JWT_SECRET that isn't valid base64 under the base64 encoding", () => {
		expect(() =>
			loadConfig({
				...baseEnv,
				JWT_SECRET: "not base64! has spaces and punctuation!!",
				JWT_SECRET_ENCODING: "base64",
			}),
		).toThrow(/Invalid environment configuration/);
	});

	it("rejects a JWT_SECRET that decodes to fewer than 16 bytes", () => {
		const shortSecret = Buffer.from("too short").toString("base64url");

		expect(() =>
			loadConfig({
				...baseEnv,
				JWT_SECRET: shortSecret,
				JWT_SECRET_ENCODING: "base64",
			}),
		).toThrow(/at least 16 bytes/);
	});
});
