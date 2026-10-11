// The app's environment contract (#182): the fields every `<name>.environment.ts` here must define.
// Services get it with `@Injectable({ deps: [ENV] })` and `constructor(env: Environment)`.
declare module "agboss" {
  interface Environment {
    /** The Greenhouse job-board API. */
    readonly greenhouseApiUrl: string;
  }
}

export {};
