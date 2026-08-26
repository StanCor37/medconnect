import { describe, it, expect } from "vitest";
import { can, type AuthContext, type Action, type ResourceRef } from "@/lib/authz/can";

function ctx(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: "actor-1",
    role: "provider_user",
    providerId: "provider-1",
    clientId: null,
    accountStatus: "active",
    ...overrides,
  };
}

describe("can() — account status gate", () => {
  it("denies every action for a non-active account, regardless of role", () => {
    for (const status of ["invited", "suspended", "deactivated"] as const) {
      const decision = can(ctx({ role: "super_admin", accountStatus: status }), "provider.view", {
        type: "Provider",
      });
      expect(decision.allowed).toBe(false);
    }
  });
});

describe("can() — creation actions (no existing resource)", () => {
  const cases: { action: Action; allowedRoles: AuthContext["role"][] }[] = [
    { action: "user.create", allowedRoles: ["super_admin", "client_admin"] },
    { action: "provider.create", allowedRoles: ["super_admin", "client_admin"] },
    { action: "client.create", allowedRoles: ["super_admin"] },
    { action: "relationship.create", allowedRoles: ["client_admin"] },
  ];
  const allRoles: AuthContext["role"][] = ["super_admin", "client_admin", "provider_user"];

  for (const { action, allowedRoles } of cases) {
    for (const role of allRoles) {
      const expected = allowedRoles.includes(role);
      it(`${action}: ${role} -> ${expected ? "allow" : "deny"}`, () => {
        const decision = can(ctx({ role }), action, { type: "User" });
        expect(decision.allowed).toBe(expected);
      });
    }
  }
});

describe("can() — user management actions are admin-only regardless of resource shape", () => {
  const actions: Action[] = ["user.suspend", "user.deactivate", "user.delete", "user.resendInvite"];
  for (const action of actions) {
    it(`${action}: provider_user is always denied`, () => {
      const decision = can(ctx({ role: "provider_user" }), action, { type: "User", providerId: "provider-1" });
      expect(decision.allowed).toBe(false);
    });
    it(`${action}: client_admin is allowed (visibility already narrowed by the caller's scoped fetch)`, () => {
      const decision = can(ctx({ role: "client_admin", clientId: "client-1" }), action, {
        type: "User",
        providerId: "provider-1",
      });
      expect(decision.allowed).toBe(true);
    });
  }
});

describe("can() — user.update allows self-edit even for a Provider User", () => {
  it("allows editing your own row", () => {
    const decision = can(ctx({ role: "provider_user", userId: "u1" }), "user.update", {
      type: "User",
      id: "u1",
    });
    expect(decision.allowed).toBe(true);
  });
  it("denies a Provider User editing someone else's row", () => {
    const decision = can(ctx({ role: "provider_user", userId: "u1" }), "user.update", {
      type: "User",
      id: "u2",
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("can() — relationship actions compare exact fetched fields (no DB-trust gap)", () => {
  const relationship: ResourceRef = {
    type: "ProviderClientRelationship",
    providerId: "provider-1",
    clientId: "client-1",
  };

  it("client_admin of the owning Client may view/activate/suspend/terminate", () => {
    const admin = ctx({ role: "client_admin", clientId: "client-1" });
    expect(can(admin, "relationship.view", relationship).allowed).toBe(true);
    expect(can(admin, "relationship.activate", relationship).allowed).toBe(true);
    expect(can(admin, "relationship.suspend", relationship).allowed).toBe(true);
    expect(can(admin, "relationship.terminate", relationship).allowed).toBe(true);
  });

  it("client_admin of a DIFFERENT Client is denied on every action, with 404 (not 403) to avoid leaking existence", () => {
    const otherAdmin = ctx({ role: "client_admin", clientId: "some-other-client" });
    for (const action of ["relationship.view", "relationship.activate"] as const) {
      const decision = can(otherAdmin, action, relationship);
      expect(decision).toEqual({ allowed: false, status: 404 });
    }
    // suspend/terminate use a flat 403 since only the owning Client Admin could ever reach that action
    for (const action of ["relationship.suspend", "relationship.terminate"] as const) {
      const decision = can(otherAdmin, action, relationship);
      expect(decision.allowed).toBe(false);
    }
  });

  it("the owning Provider's Provider User may view/activate but not suspend/terminate", () => {
    const provUser = ctx({ role: "provider_user", providerId: "provider-1", clientId: null });
    expect(can(provUser, "relationship.view", relationship).allowed).toBe(true);
    expect(can(provUser, "relationship.activate", relationship).allowed).toBe(true);
    expect(can(provUser, "relationship.suspend", relationship).allowed).toBe(false);
    expect(can(provUser, "relationship.terminate", relationship).allowed).toBe(false);
  });

  it("an unrelated Provider User is denied", () => {
    const unrelated = ctx({ role: "provider_user", providerId: "some-other-provider" });
    expect(can(unrelated, "relationship.view", relationship).allowed).toBe(false);
    expect(can(unrelated, "relationship.activate", relationship).allowed).toBe(false);
  });
});

describe("can() — client.update ownership boundary", () => {
  it("super_admin may update any Client", () => {
    expect(can(ctx({ role: "super_admin" }), "client.update", { type: "Client", id: "c1" }).allowed).toBe(true);
  });
  it("client_admin may update only their own Client", () => {
    const admin = ctx({ role: "client_admin", clientId: "c1" });
    expect(can(admin, "client.update", { type: "Client", id: "c1" }).allowed).toBe(true);
    expect(can(admin, "client.update", { type: "Client", id: "c2" })).toEqual({ allowed: false, status: 404 });
  });
  it("provider_user may never update a Client", () => {
    expect(can(ctx({ role: "provider_user" }), "client.update", { type: "Client", id: "c1" }).allowed).toBe(false);
  });
});

describe("can() — rule.* / scheme.* creation and view", () => {
  const createActions: Action[] = ["rule.create", "scheme.create"];
  for (const action of createActions) {
    it(`${action}: super_admin and client_admin allowed, provider_user denied`, () => {
      expect(can(ctx({ role: "super_admin" }), action, { type: "ValidationRule" }).allowed).toBe(true);
      expect(can(ctx({ role: "client_admin", clientId: "c1" }), action, { type: "ValidationRule" }).allowed).toBe(true);
      expect(can(ctx({ role: "provider_user" }), action, { type: "ValidationRule" }).allowed).toBe(false);
    });
  }

  const viewActions: Action[] = ["rule.view", "scheme.view"];
  for (const action of viewActions) {
    it(`${action}: allowed for every role (visibility already established by the scoped fetch)`, () => {
      for (const role of ["super_admin", "client_admin", "provider_user"] as const) {
        expect(can(ctx({ role }), action, { type: "ValidationRule", scope: "client", clientId: "other-client" }).allowed).toBe(
          true
        );
      }
    });
  }
});

describe("can() — rule.* / scheme.* mutation ownership boundary", () => {
  const mutationActions: Action[] = ["rule.update", "rule.publish", "rule.archive", "rule.delete"];
  const schemeMutationActions: Action[] = ["scheme.update", "scheme.addRule", "scheme.publish", "scheme.archive", "scheme.delete"];

  for (const action of [...mutationActions, ...schemeMutationActions]) {
    const globalResource: ResourceRef = { type: "ValidationRule", scope: "global", clientId: null };
    const clientAResource: ResourceRef = { type: "ValidationRule", scope: "client", clientId: "client-a" };

    it(`${action}: super_admin may edit a global row`, () => {
      expect(can(ctx({ role: "super_admin" }), action, globalResource).allowed).toBe(true);
    });

    it(`${action}: super_admin sees but cannot edit a Client-owned row — 403, not 404 (governance visibility, no edit rights)`, () => {
      expect(can(ctx({ role: "super_admin" }), action, clientAResource)).toEqual({ allowed: false, status: 403 });
    });

    it(`${action}: client_admin may edit their own Client's row`, () => {
      expect(can(ctx({ role: "client_admin", clientId: "client-a" }), action, clientAResource).allowed).toBe(true);
    });

    it(`${action}: client_admin of a DIFFERENT Client is denied with 404, never confirming the row's existence`, () => {
      expect(can(ctx({ role: "client_admin", clientId: "client-b" }), action, clientAResource)).toEqual({
        allowed: false,
        status: 404,
      });
    });

    it(`${action}: client_admin can never edit a global row — 404`, () => {
      expect(can(ctx({ role: "client_admin", clientId: "client-a" }), action, globalResource)).toEqual({
        allowed: false,
        status: 404,
      });
    });

    it(`${action}: provider_user is always denied`, () => {
      expect(can(ctx({ role: "provider_user" }), action, clientAResource).allowed).toBe(false);
      expect(can(ctx({ role: "provider_user" }), action, globalResource).allowed).toBe(false);
    });
  }
});

describe("can() — rule.promote is Super-Admin-only, and only against a Client-owned source", () => {
  it("super_admin may promote a Client-owned rule", () => {
    const decision = can(ctx({ role: "super_admin" }), "rule.promote", {
      type: "ValidationRule",
      scope: "client",
      clientId: "client-a",
    });
    expect(decision.allowed).toBe(true);
  });
  it("super_admin cannot 'promote' an already-global rule (nothing to promote)", () => {
    const decision = can(ctx({ role: "super_admin" }), "rule.promote", { type: "ValidationRule", scope: "global" });
    expect(decision.allowed).toBe(false);
  });
  it("client_admin can never promote, even their own rule", () => {
    const decision = can(ctx({ role: "client_admin", clientId: "client-a" }), "rule.promote", {
      type: "ValidationRule",
      scope: "client",
      clientId: "client-a",
    });
    expect(decision.allowed).toBe(false);
  });
  it("provider_user can never promote", () => {
    const decision = can(ctx({ role: "provider_user" }), "rule.promote", {
      type: "ValidationRule",
      scope: "client",
      clientId: "client-a",
    });
    expect(decision.allowed).toBe(false);
  });
});

describe("can() — case.assignScheme reuses caseMutationPolicy verbatim", () => {
  const case1: ResourceRef = { type: "Case", providerId: "provider-1", providerCaseAccess: "provider_shared" };
  it("super_admin is denied with 404 (Cases don't exist for Super Admin)", () => {
    expect(can(ctx({ role: "super_admin" }), "case.assignScheme", case1)).toEqual({ allowed: false, status: 404 });
  });
  it("the owning Provider's Provider User is allowed", () => {
    expect(can(ctx({ role: "provider_user", providerId: "provider-1" }), "case.assignScheme", case1).allowed).toBe(true);
  });
  it("a Provider User at a different Provider is denied with 404", () => {
    expect(can(ctx({ role: "provider_user", providerId: "provider-2" }), "case.assignScheme", case1)).toEqual({
      allowed: false,
      status: 404,
    });
  });
  it("client_admin is denied with 403 (they know Cases exist, just not this action)", () => {
    expect(can(ctx({ role: "client_admin", clientId: "client-1" }), "case.assignScheme", case1)).toEqual({
      allowed: false,
      status: 403,
    });
  });
});

describe("can() — document.* actions reuse caseMutationPolicy/case.view verbatim (Segment 5 spec §25: 'Document authorization inherits from the Case')", () => {
  const mutationActions: Action[] = [
    "document.upload",
    "document.replace",
    "document.archive",
    "document.delete",
    "document.confirmType",
    "document.reviewExtraction",
  ];
  const sharedCase: ResourceRef = { type: "Case", providerId: "provider-1", providerCaseAccess: "provider_shared" };
  const creatorOnlyCase: ResourceRef = {
    type: "Case",
    providerId: "provider-1",
    providerCaseAccess: "creator_only",
    createdByUserId: "creator-1",
  };

  for (const action of mutationActions) {
    it(`${action}: resolves identically to case.assign for the same resource`, () => {
      const contexts = [
        ctx({ role: "super_admin" }),
        ctx({ role: "client_admin", clientId: "client-1" }),
        ctx({ role: "provider_user", providerId: "provider-1" }),
        ctx({ role: "provider_user", providerId: "provider-2" }),
      ];
      for (const c of contexts) {
        expect(can(c, action, sharedCase)).toEqual(can(c, "case.assign", sharedCase));
      }
    });

    it(`${action}: super_admin is denied with 404 (Cases don't exist for Super Admin)`, () => {
      expect(can(ctx({ role: "super_admin" }), action, sharedCase)).toEqual({ allowed: false, status: 404 });
    });

    it(`${action}: a Provider User at a different Provider is denied with 404`, () => {
      expect(can(ctx({ role: "provider_user", providerId: "provider-2" }), action, sharedCase)).toEqual({
        allowed: false,
        status: 404,
      });
    });

    it(`${action}: client_admin is denied with 403`, () => {
      expect(can(ctx({ role: "client_admin", clientId: "client-1" }), action, sharedCase)).toEqual({
        allowed: false,
        status: 403,
      });
    });

    it(`${action}: a colleague on the same Provider cannot act on a creator_only Case's documents — 404`, () => {
      expect(can(ctx({ role: "provider_user", providerId: "provider-1", userId: "colleague-1" }), action, creatorOnlyCase)).toEqual({
        allowed: false,
        status: 404,
      });
    });

    it(`${action}: the Case's creator may act on their own creator_only Case's documents`, () => {
      expect(
        can(ctx({ role: "provider_user", providerId: "provider-1", userId: "creator-1" }), action, creatorOnlyCase).allowed
      ).toBe(true);
    });
  }

  for (const action of ["document.view", "document.download"] as Action[]) {
    it(`${action}: allowed for Client Admin and Provider User, denied with 404 for Super Admin`, () => {
      expect(can(ctx({ role: "super_admin" }), action, sharedCase)).toEqual({ allowed: false, status: 404 });
      expect(can(ctx({ role: "client_admin", clientId: "client-1" }), action, sharedCase).allowed).toBe(true);
      expect(can(ctx({ role: "provider_user", providerId: "provider-1" }), action, sharedCase).allowed).toBe(true);
    });
  }
});
