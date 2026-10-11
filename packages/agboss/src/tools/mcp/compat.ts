import { z } from "zod";

/** The part of a JSON Schema object we compare. */
const ObjectSchema = z.looseObject({
  properties: z.record(z.string(), z.looseObject({ type: z.unknown().optional() })).optional(),
  required: z.array(z.string()).optional(),
});

type ObjectShape = z.infer<typeof ObjectSchema>;

function shapeOf(schema: unknown): ObjectShape {
  const parsed = ObjectSchema.safeParse(schema);
  return parsed.success ? parsed.data : {};
}

/**
 * Compatibility, not equality: every property the server requires exists on our side, every
 * property of ours exists on the server, and shared properties agree on their JSON type.
 * Descriptions, formats and the server's optional extras never break startup.
 */
export function schemaDifferences(ours: unknown, theirs: unknown): string[] {
  const our = shapeOf(ours);
  const their = shapeOf(theirs);
  const ourProps = our.properties ?? {};
  const theirProps = their.properties ?? {};
  const problems: string[] = [];
  for (const name of their.required ?? []) {
    if (!(name in ourProps)) problems.push(`server requires "${name}", facade does not declare it`);
  }
  for (const [name, property] of Object.entries(ourProps)) {
    const theirProperty = theirProps[name];
    if (theirProperty === undefined) {
      problems.push(`facade declares "${name}", server does not know it`);
    } else if (JSON.stringify(property.type) !== JSON.stringify(theirProperty.type)) {
      problems.push(
        `"${name}": facade type ${JSON.stringify(property.type)}, server type ${JSON.stringify(theirProperty.type)}`,
      );
    }
  }
  return problems;
}
