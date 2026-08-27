import type { RlsContext } from "@/lib/db";

export type Role = "super_admin" | "client_admin" | "provider_user";
export type AccountStatus = "invited" | "active" | "suspended" | "deactivated";

export interface AuthContext extends RlsContext {
  accountStatus: AccountStatus;
}

export type Action =
  | "user.create"
  | "user.view"
  | "user.update"
  | "user.suspend"
  | "user.deactivate"
  | "user.delete"
  | "user.resendInvite"
  | "provider.create"
  | "provider.view"
  | "provider.update"
  | "client.create"
  | "client.view"
  | "client.update"
  | "relationship.create"
  | "relationship.view"
  | "relationship.activate"
  | "relationship.suspend"
  | "relationship.terminate"
  | "case.create"
  | "case.view"
  | "case.update"
  | "case.shareWithClient"
  | "case.assign"
  | "case.archive"
  | "case.restore"
  | "case.delete"
  | "case.assignScheme"
  | "case.validate"
  | "case.requestRevalidation"
  // --- Case lifecycle (Segment 8) ---
  | "case.submit"
  | "case.returnToProvider"
  | "case.accept"
  | "case.reject"
  | "case.markLiquidated"
  | "case.close"
  | "case.cancel"
  | "case.reopen"
  | "hitl.view"
  | "hitl.decide"
  | "rule.create"
  | "rule.view"
  | "rule.update"
  | "rule.publish"
  | "rule.archive"
  | "rule.delete"
  | "rule.promote"
  | "scheme.create"
  | "scheme.view"
  | "scheme.update"
  | "scheme.addRule"
  | "scheme.publish"
  | "scheme.archive"
  | "scheme.delete"
  | "document.upload"
  | "document.view"
  | "document.download"
  | "document.replace"
  | "document.archive"
  | "document.delete"
  | "document.confirmType"
  | "document.reviewExtraction"
  // --- Admin monitoring & analytics (Segment 9) ---
  | "analytics.view";

/**
 * A resource passed to `can()` must already have been fetched through the
 * matching scoped query (loadUserResource / scopedProviderWhere /
 * scopedClientWhere / a direct field comparison for relationships) — that
 * scoped fetch IS the authorization boundary establishing "this actor may
 * see this row at all" (it mirrors the RLS policies in prisma/rls.sql, which
 * aren't independently enforced yet — see the DB role note in the README).
 * `can()` therefore only needs to gate *which of the already-visible actions*
 * a role may perform — it must never re-derive visibility by trusting a
 * layer (RLS or otherwise) it cannot actually observe from a pure function.
 */
export interface ResourceRef {
  type:
    | "User"
    | "Provider"
    | "Client"
    | "ProviderClientRelationship"
    | "Case"
    | "ValidationRule"
    | "ValidationScheme"
    | "HitlTask"
    | "Analytics";
  id?: string;
  providerId?: string | null;
  clientId?: string | null;
  createdByUserId?: string | null;
  providerCaseAccess?: "creator_only" | "provider_shared" | null;
  scope?: "global" | "client" | null;
}

export type Decision = { allowed: true } | { allowed: false; status: 403 | 404 };

type Policy = (ctx: AuthContext, resource: ResourceRef) => Decision;

function allow(): Decision {
  return { allowed: true };
}
function deny(status: 403 | 404 = 403): Decision {
  return { allowed: false, status };
}

const adminRoles: Role[] = ["super_admin", "client_admin"];

const policies: Record<Action, Policy> = {
  // --- Users / accounts ---
  "user.create": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),

  // Visibility was already established by loadUserResource's scoped query.
  "user.view": () => allow(),

  "user.update": (ctx, res) =>
    res.id === ctx.userId || adminRoles.includes(ctx.role) ? allow() : deny(),

  // A role gate only: WHICH rows an admin may manage was already narrowed by
  // loadUserResource's scoped query (own scope for Client Admin, standalone
  // Providers for Super Admin). Provider Users can never manage accounts.
  "user.suspend": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),
  "user.deactivate": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),
  "user.delete": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),
  "user.resendInvite": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),

  // --- Providers ---
  "provider.create": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),

  // Visibility established by scopedProviderWhere (see route handler).
  "provider.view": () => allow(),
  "provider.update": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),

  // --- Clients ---
  "client.create": (ctx) => (ctx.role === "super_admin" ? allow() : deny()),
  "client.view": () => allow(), // visibility established by scopedClientWhere
  "client.update": (ctx, res) => {
    if (ctx.role === "super_admin") return allow();
    if (ctx.role === "client_admin") return res.id === ctx.clientId ? allow() : deny(404);
    return deny();
  },

  // --- Provider-Client relationships ---
  // These compare exact fetched fields directly (no DB-trust gap) since the
  // relationship row's own providerId/clientId columns ARE the ownership
  // boundary — no further scoped query is needed.
  "relationship.create": (ctx) => (ctx.role === "client_admin" ? allow() : deny()),
  "relationship.view": (ctx, res) => {
    if (ctx.role === "super_admin") return allow();
    if (ctx.role === "client_admin") return res.clientId === ctx.clientId ? allow() : deny(404);
    if (ctx.role === "provider_user") return res.providerId === ctx.providerId ? allow() : deny(404);
    return deny(404);
  },
  "relationship.activate": (ctx, res) => {
    if (ctx.role === "client_admin") return res.clientId === ctx.clientId ? allow() : deny(404);
    if (ctx.role === "provider_user") return res.providerId === ctx.providerId ? allow() : deny(404);
    return deny();
  },
  "relationship.suspend": (ctx, res) =>
    ctx.role === "client_admin" && res.clientId === ctx.clientId ? allow() : deny(),
  "relationship.terminate": (ctx, res) =>
    ctx.role === "client_admin" && res.clientId === ctx.clientId ? allow() : deny(),

  // --- Cases ---
  // Super Admin is hard-denied on every single Case action, unconditionally,
  // as the FIRST check — literal redundancy with scopedCaseWhere's
  // always-impossible predicate, per the spec's absolute "no Case access
  // whatsoever" rule (the one place this codebase deliberately duplicates a
  // check rather than trusting a single layer).
  "case.create": (ctx) => {
    if (ctx.role === "super_admin") return deny(404);
    return ctx.role === "provider_user" ? allow() : deny(403);
  },
  // Visibility already established by scopedCaseWhere (see route handler) —
  // re-checked here for Super Admin only, deliberately redundant.
  "case.view": (ctx) => (ctx.role === "super_admin" ? deny(404) : allow()),
  "case.update": caseMutationPolicy,
  "case.shareWithClient": caseMutationPolicy,
  "case.assign": caseMutationPolicy,
  "case.archive": caseMutationPolicy,
  "case.restore": caseMutationPolicy,
  "case.delete": caseMutationPolicy,
  "case.assignScheme": caseMutationPolicy,
  // Provider-only, matches spec Segment 7 §4 "Provider Users may validate."
  "case.validate": caseMutationPolicy,
  // Client Admin only — ownership already established by the scoped fetch
  // that loaded this Case (same reasoning as case.view's redundant check).
  "case.requestRevalidation": (ctx) => (ctx.role === "client_admin" ? allow() : deny(403)),

  // --- Case lifecycle (Segment 8) ---
  // Provider-only actions.
  "case.submit": caseMutationPolicy,
  // Client-Admin-only actions — this is the first Client Admin Case-MUTATION
  // authority in the codebase (previously Client Admin only ever decided
  // HITL tasks, never touched the Case itself).
  "case.returnToProvider": clientCaseMutationPolicy,
  "case.accept": clientCaseMutationPolicy,
  "case.reject": clientCaseMutationPolicy,
  "case.markLiquidated": clientCaseMutationPolicy,
  // Dual-actor: whichever role currently holds the Case's mutation rights —
  // ctx.role alone disambiguates which of the two ownership checks applies,
  // no route-level branching needed.
  "case.close": lifecycleDualActorPolicy,
  "case.cancel": lifecycleDualActorPolicy,
  "case.reopen": lifecycleDualActorPolicy,

  // --- HITL tasks (Segment 7) ---
  // Provider User: read-only (spec §15 "inspect evidence", never decide).
  // Client Admin: must own the task's assignedClientId — re-checked here in
  // addition to scopedHitlTaskWhere's own active-relationship join, same
  // defense-in-depth relationship every other resource type gets.
  "hitl.view": (ctx, res) => {
    if (ctx.role === "super_admin") return deny(404);
    if (ctx.role === "client_admin") return res.clientId === ctx.clientId ? allow() : deny(404);
    return allow();
  },
  "hitl.decide": (ctx, res) => (ctx.role === "client_admin" && res.clientId === ctx.clientId ? allow() : deny(404)),

  // --- Validation Rules ---
  "rule.create": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),
  "rule.view": () => allow(), // visibility established by scopedRuleWhere
  "rule.update": ruleMutationPolicy,
  "rule.publish": ruleMutationPolicy,
  "rule.archive": ruleMutationPolicy,
  "rule.delete": ruleMutationPolicy,
  "rule.promote": (ctx, res) => (ctx.role === "super_admin" && res.scope === "client" ? allow() : deny(403)),

  // --- Validation Schemes ---
  "scheme.create": (ctx) => (adminRoles.includes(ctx.role) ? allow() : deny()),
  "scheme.view": () => allow(), // visibility established by scopedSchemeWhere
  "scheme.update": schemeMutationPolicy,
  "scheme.addRule": schemeMutationPolicy,
  "scheme.publish": schemeMutationPolicy,
  "scheme.archive": schemeMutationPolicy,
  "scheme.delete": schemeMutationPolicy,

  // --- Documents ---
  // "Document authorization inherits from the Case" (spec Segment 5 §25) —
  // implemented literally by reusing caseMutationPolicy/case.view verbatim
  // against the Document's parent Case ResourceRef, the same way
  // case.assignScheme reused it for Segment 3.
  "document.upload": caseMutationPolicy,
  "document.replace": caseMutationPolicy,
  "document.archive": caseMutationPolicy,
  "document.delete": caseMutationPolicy,
  "document.confirmType": caseMutationPolicy,
  "document.reviewExtraction": caseMutationPolicy,
  "document.view": (ctx) => (ctx.role === "super_admin" ? deny(404) : allow()), // == case.view, verbatim
  "document.download": (ctx) => (ctx.role === "super_admin" ? deny(404) : allow()),

  // --- Admin monitoring & analytics (Segment 9) ---
  // Client Admin only — Provider Users don't have this dashboard at all
  // (role-level 403), Super Admin gets its own separate aggregate view in a
  // later pass, not this Client-scoped one (404, matching the "Super Admin
  // pretends Cases don't exist" convention above).
  "analytics.view": (ctx) => {
    if (ctx.role === "client_admin") return allow();
    return deny(ctx.role === "super_admin" ? 404 : 403);
  },
};

// Super Admin CAN see a Client-owned rule/scheme (governance) but never edit
// it — 403, not 404, since it does know the row exists. Client Admin must
// never learn whether a rule/scheme id belongs to another Client or is a
// global row only Super Admin may edit — 404, not 403.
function ruleMutationPolicy(ctx: AuthContext, res: ResourceRef): Decision {
  if (ctx.role === "super_admin") return res.scope === "global" ? allow() : deny(403);
  if (ctx.role === "client_admin") return res.scope === "client" && res.clientId === ctx.clientId ? allow() : deny(404);
  return deny(403);
}
function schemeMutationPolicy(ctx: AuthContext, res: ResourceRef): Decision {
  return ruleMutationPolicy(ctx, res);
}

function caseMutationPolicy(ctx: AuthContext, res: ResourceRef): Decision {
  if (ctx.role === "super_admin") return deny(404); // pretend Cases don't exist — literal, never a 403
  if (ctx.role !== "provider_user") return deny(403); // Client Admin: role-level "not for you" — they DO know Cases exist (can view shared ones)
  if (res.providerId !== ctx.providerId) return deny(404); // cross-Provider — never confirm existence
  if (res.providerCaseAccess === "creator_only" && res.createdByUserId !== ctx.userId) return deny(404); // invisible to colleagues, matches scopedCaseWhere
  return allow();
}

// Client Admin's Case-mutation authority (Segment 8): the `clientId` match
// on top of whatever scoped fetch already loaded this Case (that fetch is
// where the active-relationship requirement is enforced — same shape as
// hitl.decide's own resource check against a HitlTask's assignedClientId).
function clientCaseMutationPolicy(ctx: AuthContext, res: ResourceRef): Decision {
  if (ctx.role === "super_admin") return deny(404);
  if (ctx.role !== "client_admin") return deny(403);
  return res.clientId === ctx.clientId ? allow() : deny(404);
}

function lifecycleDualActorPolicy(ctx: AuthContext, res: ResourceRef): Decision {
  if (ctx.role === "provider_user") return caseMutationPolicy(ctx, res);
  if (ctx.role === "client_admin") return clientCaseMutationPolicy(ctx, res);
  return deny(404); // super_admin
}

/**
 * Central authorization guard — deny by default. This is a role/action gate
 * layered on top of a resource that a scoped DB query has already confirmed
 * is visible to the actor (see the ResourceRef doc comment above). It is
 * defense-in-depth alongside RLS, not a substitute for the scoped fetch.
 */
export function can(ctx: AuthContext, action: Action, resource: ResourceRef): Decision {
  if (ctx.accountStatus !== "active") return deny(403);
  const policy = policies[action];
  if (!policy) return deny(403);
  return policy(ctx, resource);
}
