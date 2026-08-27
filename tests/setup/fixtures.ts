import { testDb, uniqueSuffix } from "./testDb";
import type { AuthContext } from "@/lib/authz/can";

/**
 * Builds one isolated set of orgs/users per test run, tagged with a random
 * suffix so it can never collide with real seed data (prisma/seed.ts) or
 * another concurrent run against the same database — this is what lets the
 * suite run safely without a dedicated test branch. `cleanup()` deletes
 * exactly the rows this call created, in FK-safe order.
 */
export async function buildFixtures() {
  const s = uniqueSuffix();
  const emails = {
    superAdmin: `super-${s}@test.medconnect.invalid`,
    clientAdminA: `admin-a-${s}@test.medconnect.invalid`,
    clientAdminB: `admin-b-${s}@test.medconnect.invalid`,
    providerUserStandalone: `prov-standalone-${s}@test.medconnect.invalid`,
    providerUserConnected: `prov-connected-${s}@test.medconnect.invalid`,
    providerUserConnectedColleague: `prov-connected-colleague-${s}@test.medconnect.invalid`,
  };

  const superAdmin = await testDb.user.create({
    data: { email: emails.superAdmin, role: "super_admin", status: "active", firstName: "T", lastName: "SuperAdmin" },
  });

  const clientA = await testDb.client.create({
    data: { legalName: `Test Client A ${s}`, capabilities: ["assistance_company"] },
  });
  const clientB = await testDb.client.create({
    data: { legalName: `Test Client B ${s}`, capabilities: ["insurance_company"] },
  });

  const clientAdminA = await testDb.user.create({
    data: {
      email: emails.clientAdminA,
      role: "client_admin",
      status: "active",
      firstName: "T",
      lastName: "AdminA",
      clientId: clientA.id,
      createdByUserId: superAdmin.id,
    },
  });
  const clientAdminB = await testDb.user.create({
    data: {
      email: emails.clientAdminB,
      role: "client_admin",
      status: "active",
      firstName: "T",
      lastName: "AdminB",
      clientId: clientB.id,
      createdByUserId: superAdmin.id,
    },
  });

  const providerStandalone = await testDb.provider.create({
    data: {
      legalName: `Test Standalone Provider ${s}`,
      normalizedName: `test standalone provider ${s}`,
      mode: "standalone",
      country: "RS",
      officialRegistrationNumber: `TEST-REG-${s}`,
      createdBySuperAdminId: superAdmin.id,
    },
  });
  const providerUserStandalone = await testDb.user.create({
    data: {
      email: emails.providerUserStandalone,
      role: "provider_user",
      status: "active",
      firstName: "T",
      lastName: "ProvStandalone",
      providerId: providerStandalone.id,
      createdByUserId: superAdmin.id,
    },
  });

  const providerConnected = await testDb.provider.create({
    data: {
      legalName: `Test Connected Provider ${s}`,
      normalizedName: `test connected provider ${s}`,
      mode: "client_connected",
      country: "RS",
      officialRegistrationNumber: `TEST-REG-2-${s}`,
      createdByClientAdminId: clientAdminA.id,
    },
  });
  const activeRelationship = await testDb.providerClientRelationship.create({
    data: { providerId: providerConnected.id, clientId: clientA.id, status: "active", activatedAt: new Date() },
  });
  const providerUserConnected = await testDb.user.create({
    data: {
      email: emails.providerUserConnected,
      role: "provider_user",
      status: "active",
      firstName: "T",
      lastName: "ProvConnected",
      providerId: providerConnected.id,
      createdByUserId: clientAdminA.id,
    },
  });
  // A colleague on the SAME Provider — used to test provider_case_access:
  // "creator_only" exclusion (invisible to colleagues, visible to its creator).
  const providerUserConnectedColleague = await testDb.user.create({
    data: {
      email: emails.providerUserConnectedColleague,
      role: "provider_user",
      status: "active",
      firstName: "T",
      lastName: "ProvConnectedColleague",
      providerId: providerConnected.id,
      createdByUserId: clientAdminA.id,
    },
  });

  // A pending relationship between the connected Provider and Client B —
  // Client B must NOT gain any visibility from this until it's activated.
  const pendingRelationship = await testDb.providerClientRelationship.create({
    data: { providerId: providerConnected.id, clientId: clientB.id, status: "pending" },
  });

  // Insurer recognition must never grant access — see cases-scoping.test.ts.
  const insurer = await testDb.insurer.create({
    data: { name: `Test Insurer ${s}`, country: "RS" },
  });

  const userIds = [
    superAdmin.id,
    clientAdminA.id,
    clientAdminB.id,
    providerUserStandalone.id,
    providerUserConnected.id,
    providerUserConnectedColleague.id,
  ];
  const relationshipIds = [activeRelationship.id, pendingRelationship.id];
  const providerIds = [providerStandalone.id, providerConnected.id];
  const clientIds = [clientA.id, clientB.id];

  async function cleanup() {
    // Case has RESTRICT (not SetNull) FKs to Provider/User, so Case rows
    // must be deleted before those — otherwise the deletes below fail.
    await testDb.idempotencyKey.deleteMany({ where: { providerId: { in: providerIds } } });
    await testDb.caseStatusHistory.deleteMany({ where: { case: { providerId: { in: providerIds } } } });
    await testDb.case.deleteMany({ where: { providerId: { in: providerIds } } });
    await testDb.auditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { providerId: { in: providerIds } },
          { clientId: { in: clientIds } },
          { relationshipId: { in: relationshipIds } },
        ],
      },
    });
    await testDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await testDb.invitation.deleteMany({ where: { userId: { in: userIds } } });
    await testDb.user.deleteMany({ where: { id: { in: userIds } } });
    await testDb.providerClientRelationship.deleteMany({ where: { id: { in: relationshipIds } } });
    await testDb.provider.deleteMany({ where: { id: { in: providerIds } } });
    await testDb.client.deleteMany({ where: { id: { in: clientIds } } });
    await testDb.insurer.deleteMany({ where: { id: insurer.id } });
  }

  function authFor(
    role:
      | "superAdmin"
      | "clientAdminA"
      | "clientAdminB"
      | "providerUserStandalone"
      | "providerUserConnected"
      | "providerUserConnectedColleague"
  ): AuthContext {
    const map: Record<typeof role, AuthContext> = {
      superAdmin: {
        userId: superAdmin.id,
        role: "super_admin",
        providerId: null,
        clientId: null,
        accountStatus: "active",
      },
      clientAdminA: {
        userId: clientAdminA.id,
        role: "client_admin",
        providerId: null,
        clientId: clientA.id,
        accountStatus: "active",
      },
      clientAdminB: {
        userId: clientAdminB.id,
        role: "client_admin",
        providerId: null,
        clientId: clientB.id,
        accountStatus: "active",
      },
      providerUserStandalone: {
        userId: providerUserStandalone.id,
        role: "provider_user",
        providerId: providerStandalone.id,
        clientId: null,
        accountStatus: "active",
      },
      providerUserConnected: {
        userId: providerUserConnected.id,
        role: "provider_user",
        providerId: providerConnected.id,
        clientId: null,
        accountStatus: "active",
      },
      providerUserConnectedColleague: {
        userId: providerUserConnectedColleague.id,
        role: "provider_user",
        providerId: providerConnected.id,
        clientId: null,
        accountStatus: "active",
      },
    };
    return map[role];
  }

  return {
    suffix: s,
    superAdmin,
    clientA,
    clientB,
    clientAdminA,
    clientAdminB,
    providerStandalone,
    providerConnected,
    providerUserStandalone,
    providerUserConnected,
    providerUserConnectedColleague,
    activeRelationship,
    pendingRelationship,
    insurer,
    authFor,
    cleanup,
  };
}

export type Fixtures = Awaited<ReturnType<typeof buildFixtures>>;
