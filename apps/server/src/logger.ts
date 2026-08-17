/**
 * Logger mínimo, atrás de uma interface pequena, com saída JSON em uma
 * linha (fácil de agregar mesmo sem um coletor estruturado). Trocar para
 * pino/winston no futuro é reescrever este arquivo — nada mais no projeto
 * importa de uma lib de log diretamente.
 */
export interface Logger {
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
}

type Level = "INFO" | "WARN" | "ERROR";

function write(level: Level, message: string, context?: Record<string, unknown>): void {
	const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...context });
	if (level === "ERROR") {
		console.error(line);
	} else if (level === "WARN") {
		console.warn(line);
	} else {
		console.log(line);
	}
}

export const logger: Logger = {
	info: (message, context) => write("INFO", message, context),
	warn: (message, context) => write("WARN", message, context),
	error: (message, context) => write("ERROR", message, context),
};
