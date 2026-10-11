/**
 * `agboss/dto` — data shapes as classes, one field decorator per field (Wiki → Components,
 * Standard DTOs). zod stays inside the framework.
 */
import "../polyfills/symbol-metadata.js";

export {
  CountryCode,
  CurrencyCode,
  Date,
  DateTime,
  Decimal,
  DecimalString,
  Duration,
  Email,
  Flag,
  Integer,
  ListOf,
  MediaType,
  Nested,
  OneOf,
  PhoneNumber,
  Text,
  TimeZone,
  Url,
  Uuid,
  type ListItem,
} from "./decorators.js";
export { DtoError, DtoValidationError, type DtoErrorCode, type DtoIssue } from "./errors.js";
export type {
  DtoClass,
  FieldDecorator,
  FieldFactory,
  FieldOptions,
  OptionalField,
  RequiredField,
  Sensitivity,
} from "./types.js";
export {
  NoInput,
  PlainText,
  RagSearchResult,
  ToolCallApprovalAsk,
  ToolCallApprovalDecision,
  WorkflowFinishText,
  WorkflowPauseAnswer,
  WorkflowPauseQuestion,
  WorkflowStartText,
} from "./standard/framework.js";
export {
  Address,
  Attachment,
  ContactInfo,
  DateRange,
  DateTimeRange,
  Money,
  PersonName,
  RagSourceReference,
} from "./standard/domain.js";
