import { ScaffoldUsageError } from "./errors.js";

/** One name in every spelling the generated code needs. */
export interface Names {
  /** file and folder names, workflow names: `search-orders` */
  readonly kebab: string;
  /** tool, agent and knowledge-base names: `search_orders` */
  readonly snake: string;
  /** class names: `SearchOrders` */
  readonly pascal: string;
  /** prose: `Search orders` */
  readonly title: string;
}

const words = (raw: string): string[] =>
  raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** `"Search Orders"`, `searchOrders`, `search-orders` → one `Names`; letters first, letters and digits only. */
export function namesOf(raw: string): Names {
  const parts = words(raw);
  const [first] = parts;
  if (first === undefined || !/^[a-z]/.test(first)) {
    throw new ScaffoldUsageError(
      `"${raw}" is not a valid name: start with a letter, use letters and digits`,
    );
  }
  return {
    kebab: parts.join("-"),
    snake: parts.join("_"),
    pascal: parts.map(capital).join(""),
    title: capital(parts.join(" ")),
  };
}
