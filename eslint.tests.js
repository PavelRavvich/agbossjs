// Lint rules for test files (split from eslint.config.js to keep it under the line limit).
const FAKE_INTERRUPT = [
  "AssignmentExpression[left.object.type!='ThisExpression'][left.property.name='name'][right.value=/Interrupt$/]",
  "Property[key.name='name'][value.value=/Interrupt$/]",
].map((selector) => ({
  selector,
  message: "Do not fake a LangGraph interrupt — pause the run for real (testWith).",
}));

export const testRules = {
  files: [
    "packages/agboss/tests/**/*.ts",
    "packages/agboss-cli/tests/**/*.ts",
    "examples/*/tests/**/*.ts",
  ],
  rules: {
    "max-lines": "off",
    "max-lines-per-function": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unused-vars": "off",
    // a test must not imitate the framework's failures: the real path has to produce them (#180)
    "no-restricted-syntax": ["error", ...FAKE_INTERRUPT],
  },
};
