import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import {
  scopedProviderWhere,
  scopedClientWhere,
  scopedRelationshipWhere,
  scopedUserWhere,
} from "@/lib/organizations/scoping";

/**
 * These tests exercise the ACTUAL authorization boundary in the app today
 * (see README's RLS TODO: table ownership currently bypasses RLS, so
 * scopedXWhere is what really enforces tenant isolation, not the SQL
 * policies in prisma/rls.sql). They run against real Postgres with an
 * isolated, uniquely-suffixed fixture set rather than a dedicated test
 * database, per the "skip the branch" decision — cleanup() removes exactly
 * what this file created.
 */
describe("app-layer scoping (the real authorization boundary today)", () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await buildFixtures();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  describe("scopedProviderWhere", () => {
    it("Super Admin sees only standalone Providers", async () => {
      const rows = await testDb.provider.findMany({
        where: { id: { in: [fx.providerStandalone.id, fx.providerConnected.id] }, ...scopedProviderWhere(fx.authFor("superAdmin")) },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.providerStandalone.id]);
    });

    it("Client Admin A sees the Provider it has an ACTIVE relationship with, not the standalone one", async () => {
      const rows = await testDb.provider.findMany({
        where: { id: { in: [fx.providerStandalone.id, fx.providerConnected.id] }, ...scopedProviderWhere(fx.authFor("clientAdminA")) },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.providerConnected.id]);
    });

    it("Client Admin B sees NOTHING — its relationship to the connected Provider is only PENDING", async () => {
      const rows = await testDb.provider.findMany({
        where: { id: { in: [fx.providerStandalone.id, fx.providerConnected.id] }, ...scopedProviderWhere(fx.authFor("clientAdminB")) },
      });
      expect(rows).toHaveLength(0);
    });

    it("a Provider User sees only their own Provider", async () => {
      const rows = await testDb.provider.findMany({
        where: { id: { in: [fx.providerStandalone.id, fx.providerConnected.id] }, ...scopedProviderWhere(fx.authFor("providerUserStandalone")) },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.providerStandalone.id]);
    });
  });

  describe("scopedClientWhere", () => {
    it("Super Admin sees all Clients", async () => {
      const rows = await testDb.client.findMany({
        where: { id: { in: [fx.clientA.id, fx.clientB.id] }, ...scopedClientWhere(fx.authFor("superAdmin")) },
      });
      expect(rows.map((r) => r.id).sort()).toEqual([fx.clientA.id, fx.clientB.id].sort());
    });

    it("Client Admin sees only its own Client", async () => {
      const rows = await testDb.client.findMany({
        where: { id: { in: [fx.clientA.id, fx.clientB.id] }, ...scopedClientWhere(fx.authFor("clientAdminA")) },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.clientA.id]);
    });

    it("a connected Provider User sees Client A (active) and Client B (pending) — any relationship counts here", async () => {
      const rows = await testDb.client.findMany({
        where: { id: { in: [fx.clientA.id, fx.clientB.id] }, ...scopedClientWhere(fx.authFor("providerUserConnected")) },
      });
      expect(rows.map((r) => r.id).sort()).toEqual([fx.clientA.id, fx.clientB.id].sort());
    });

    it("the standalone Provider User (zero relationships) sees no Clients", async () => {
      const rows = await testDb.client.findMany({
        where: { id: { in: [fx.clientA.id, fx.clientB.id] }, ...scopedClientWhere(fx.authFor("providerUserStandalone")) },
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe("scopedRelationshipWhere", () => {
    it("Super Admin sees every relationship", async () => {
      const rows = await testDb.providerClientRelationship.findMany({
        where: { id: { in: [fx.activeRelationship.id, fx.pendingRelationship.id] }, ...scopedRelationshipWhere(fx.authFor("superAdmin")) },
      });
      expect(rows).toHaveLength(2);
    });

    it("Client Admin B sees only its own (pending) relationship, not Client A's active one", async () => {
      const rows = await testDb.providerClientRelationship.findMany({
        where: { id: { in: [fx.activeRelationship.id, fx.pendingRelationship.id] }, ...scopedRelationshipWhere(fx.authFor("clientAdminB")) },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.pendingRelationship.id]);
    });

    it("suspending Client A's relationship does not affect Client B's pending relationship to the same Provider", async () => {
      // Isolation check (Segment 2 §3): touch one relationship, verify the sibling is untouched.
      await testDb.providerClientRelationship.update({
        where: { id: fx.activeRelationship.id },
        data: { status: "suspended", suspendedAt: new Date() },
      });
      const sibling = await testDb.providerClientRelationship.findUniqueOrThrow({
        where: { id: fx.pendingRelationship.id },
      });
      expect(sibling.status).toBe("pending");
      // restore for any later assertions in this file
      await testDb.providerClientRelationship.update({
        where: { id: fx.activeRelationship.id },
        data: { status: "active", suspendedAt: null },
      });
    });
  });

  describe("scopedUserWhere", () => {
    it("Super Admin sees Admins and standalone Providers' users, never the connected Provider's user", async () => {
      const ids = [fx.superAdmin.id, fx.clientAdminA.id, fx.providerUserStandalone.id, fx.providerUserConnected.id];
      const rows = await testDb.user.findMany({
        where: { id: { in: ids }, OR: [{ id: fx.superAdmin.id }, scopedUserWhere(fx.authFor("superAdmin"))] },
      });
      const visibleIds = rows.map((r) => r.id).sort();
      expect(visibleIds).toEqual([fx.superAdmin.id, fx.clientAdminA.id, fx.providerUserStandalone.id].sort());
      expect(visibleIds).not.toContain(fx.providerUserConnected.id);
    });

    it("Client Admin A sees the connected Provider's user (active relationship), not the standalone one", async () => {
      const ids = [fx.providerUserStandalone.id, fx.providerUserConnected.id];
      const rows = await testDb.user.findMany({
        where: { id: { in: ids }, OR: [{ id: fx.clientAdminA.id }, scopedUserWhere(fx.authFor("clientAdminA"))] },
      });
      expect(rows.map((r) => r.id)).toEqual([fx.providerUserConnected.id]);
    });

    it("Client Admin B sees NEITHER Provider User — its only relationship is pending", async () => {
      const ids = [fx.providerUserStandalone.id, fx.providerUserConnected.id];
      const rows = await testDb.user.findMany({
        where: { id: { in: ids }, OR: [{ id: fx.clientAdminB.id }, scopedUserWhere(fx.authFor("clientAdminB"))] },
      });
      expect(rows).toHaveLength(0);
    });

    it("a Provider User always sees their own row via the universal self-clause", async () => {
      const rows = await testDb.user.findMany({
        where: {
          id: fx.providerUserStandalone.id,
          OR: [{ id: fx.providerUserStandalone.id }, scopedUserWhere(fx.authFor("providerUserStandalone"))],
        },
      });
      expect(rows).toHaveLength(1);
    });
  });
});
