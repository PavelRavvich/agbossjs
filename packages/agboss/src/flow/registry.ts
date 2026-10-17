import type { Class } from "../components/injection.js";
import type { Brand } from "../types/brand.js";
import type { DtoClass } from "../dto/types.js";
import type { ComponentDeclaration } from "./decorators/declaration.js";
import { declarationOf } from "./decorators/declaration.js";

/**
 * The registries of an application (#272 S5), built by the loader in one pass: components by
 * `name`, DTO classes by class name. Both names key checkpoints, so each is unique in the
 * application; a second entry under a taken name is a clash the analyser reports.
 */

/** A component's `name` (`draft-agent`), unique in the application. */
export type ComponentName = Brand<string, "ComponentName">;

/** A DTO's class name (`OfferDraftDto`), unique in the application. */
export type DtoName = Brand<string, "DtoName">;

/** Two different entries under one name. */
export interface RegistryClash<TEntry> {
  readonly name: string;
  readonly registered: TEntry;
  readonly clashing: TEntry;
}

/** Entries by a unique name; adding the same entry again is not a clash. */
export class NameRegistry<TName extends string, TEntry> {
  private readonly entries = new Map<TName, TEntry>();

  constructor(private readonly isSame: (first: TEntry, second: TEntry) => boolean) {}

  /** Adds an entry; returns the clash when another entry holds the name (the first one stays). */
  add(name: TName, entry: TEntry): RegistryClash<TEntry> | undefined {
    const registered = this.entries.get(name);
    if (registered === undefined) {
      this.entries.set(name, entry);
      return undefined;
    }
    return this.isSame(registered, entry) ? undefined : { name, registered, clashing: entry };
  }

  get(name: TName): TEntry | undefined {
    return this.entries.get(name);
  }

  get names(): readonly TName[] {
    return [...this.entries.keys()];
  }
}

/** A registered component: its class and what its v2 decorator recorded. */
export interface ComponentEntry {
  readonly name: ComponentName;
  readonly component: Class;
  readonly declaration: ComponentDeclaration;
}

/** A registered DTO class and the file it is exported from, when the loader knows it. */
export interface DtoEntry {
  readonly name: DtoName;
  readonly dto: DtoClass;
  readonly file?: string;
}

/** The components of an application by `name`. */
export class ComponentRegistry {
  private readonly byName = new NameRegistry<ComponentName, ComponentEntry>(
    (first, second) => first.component === second.component,
  );

  /** Registers a v2-decorated class; `undefined` for a class without a v2 decorator. */
  register(component: Class): RegistryClash<ComponentEntry> | undefined {
    const declaration = declarationOf(component);
    if (declaration === undefined) return undefined;
    const name = declaration.options.name as ComponentName;
    return this.byName.add(name, { name, component, declaration });
  }

  get(name: string): ComponentEntry | undefined {
    return this.byName.get(name as ComponentName);
  }

  get names(): readonly ComponentName[] {
    return this.byName.names;
  }
}

/** The DTO classes of an application by class name. */
export class DtoRegistry {
  private readonly byName = new NameRegistry<DtoName, DtoEntry>(
    (first, second) => first.dto === second.dto,
  );

  register(dto: DtoClass, file?: string): RegistryClash<DtoEntry> | undefined {
    const name = dto.name as DtoName;
    return this.byName.add(name, file === undefined ? { name, dto } : { name, dto, file });
  }

  get(name: string): DtoClass | undefined {
    return this.byName.get(name as DtoName)?.dto;
  }

  get names(): readonly DtoName[] {
    return this.byName.names;
  }
}

/** `ResultDto is declared in a.dto.ts and b.dto.ts — DTO names are unique …` (`[dto.duplicate-name]`). */
export function dtoClashMessage(clash: RegistryClash<DtoEntry>): string {
  const where = (entry: DtoEntry): string => entry.file ?? "(unknown file)";
  return (
    `${clash.name} is declared in ${where(clash.registered)} and ${where(clash.clashing)} — ` +
    "DTO names are unique in the application (they key checkpoints)"
  );
}
