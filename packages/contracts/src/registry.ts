import type { z } from "zod";
import { envelopeBaseSchema, type ClientEvent, type EnvelopeBase } from "./envelope.js";

/**
 * Descreve um tipo de notificação: sua chave (`type`), a versão do seu
 * schema (`v`, para evolução futura) e o schema Zod do `payload`. Este é o
 * único artefato que um novo tipo de evento precisa produzir.
 */
export interface EventDefinition<
  Type extends string = string,
  PayloadSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  type: Type;
  v: number;
  payload: PayloadSchema;
}

export function defineEvent<Type extends string, PayloadSchema extends z.ZodTypeAny>(
  definition: EventDefinition<Type, PayloadSchema>,
): EventDefinition<Type, PayloadSchema> {
  return definition;
}

export type ParsedEnvelope<Def extends EventDefinition> = Omit<EnvelopeBase, "type" | "payload"> & {
  type: Def["type"];
  payload: z.infer<Def["payload"]>;
};

export type ParseEnvelopeError =
  | { kind: "invalid_envelope"; issues: z.ZodIssue[] }
  | { kind: "unknown_type"; type: string; knownTypes: string[] }
  | { kind: "invalid_payload"; type: string; issues: z.ZodIssue[] };

export type ParseEnvelopeResult<Def extends EventDefinition> =
  { ok: true; envelope: ParsedEnvelope<Def> } | { ok: false; error: ParseEnvelopeError };

/**
 * Catálogo de tipos de notificação conhecidos. É o ponto único de extensão:
 * adicionar uma notificação nova é `.register(defineEvent({...}))`, nada no
 * servidor, na autenticação ou no roteamento de salas precisa mudar.
 *
 * O parâmetro de tipo `Defs` acumula a união de definições registradas, o
 * que dá ao `parseEnvelope` um retorno tipado (`payload` sabe sua forma para
 * cada `type`) sem precisar de um switch manual em nenhum lugar.
 */
export class EventRegistry<Defs extends EventDefinition = never> {
  private readonly definitions = new Map<string, EventDefinition>();

  register<Type extends string, PayloadSchema extends z.ZodTypeAny>(
    definition: EventDefinition<Type, PayloadSchema>,
  ): EventRegistry<Defs | EventDefinition<Type, PayloadSchema>> {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Event type "${definition.type}" already registered.`);
    }
    this.definitions.set(definition.type, definition);
    return this as EventRegistry<Defs | EventDefinition<Type, PayloadSchema>>;
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }

  /**
   * Valida um envelope cru (ex.: corpo JSON do webhook) contra o schema base
   * e, em seguida, contra o schema de payload registrado para o seu `type`.
   * Tipo desconhecido e payload inválido são erros distintos e tipados —
   * quem chama decide o status HTTP (ambos viram 422 na ingestão atual).
   */
  parseEnvelope(input: unknown): ParseEnvelopeResult<Defs> {
    const base = envelopeBaseSchema.safeParse(input);
    if (!base.success) {
      return { ok: false, error: { kind: "invalid_envelope", issues: base.error.issues } };
    }

    const definition = this.definitions.get(base.data.type);
    if (!definition) {
      return {
        ok: false,
        error: { kind: "unknown_type", type: base.data.type, knownTypes: this.types() },
      };
    }

    const payload = definition.payload.safeParse(base.data.payload);
    if (!payload.success) {
      return {
        ok: false,
        error: { kind: "invalid_payload", type: base.data.type, issues: payload.error.issues },
      };
    }

    return {
      ok: true,
      envelope: { ...base.data, payload: payload.data } as ParsedEnvelope<Defs>,
    };
  }

  /** Projeta um envelope validado no formato que trafega para o navegador. */
  toClientEvent(envelope: EnvelopeBase): ClientEvent {
    return {
      id: envelope.id,
      type: envelope.type,
      v: envelope.v,
      occurredAt: envelope.occurredAt,
      payload: envelope.payload,
    };
  }
}

export function createRegistry(): EventRegistry {
  return new EventRegistry();
}
