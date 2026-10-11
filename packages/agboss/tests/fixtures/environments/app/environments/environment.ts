// The fixture app's environment contract (#182) — what an app writes as
// `declare module "agboss" { interface Environment { … } }`.
declare module "../../../../../src/environments/define.js" {
  interface Environment {
    readonly apiUrl: string;
    readonly apiKey: string;
    readonly currency: string;
  }
}

export {};
