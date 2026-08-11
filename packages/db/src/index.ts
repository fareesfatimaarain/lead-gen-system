export * from "./client";
export * from "./crypto";
export * from "./rate-limit";
export * as schema from "./schema/index";
export { ORG_SCOPED_TABLES } from "./schema/index";

// The structured shapes stored inside jsonb columns. Exported as types so the
// UI and the agents share one definition of what is in there — a jsonb column
// whose shape is only known to the code that wrote it is an untyped blob.
export type {
  Activity, Booking, Call, Campaign, Company, Credential, Email, EmailReply,
  GuardrailEvent, Icp, IcpGeography, Mailbox, Org, OrgMember, ProofAsset, Prospect,
  ProspectScore, ProspectSignal, QualifyingSignal, ScoreCriterion, Sequence,
  SequenceStep, Session, Settings, Suppression, TranscriptTurn, User, ValidatorReport,
} from "./schema/index";

// Re-export the drizzle query builders every consumer needs, so application
// code imports from one place rather than reaching into drizzle-orm directly.
export {
  and, asc, avg, count, countDistinct, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull,
  lt, lte, ne, notInArray, or, sql, sum,
} from "drizzle-orm";
