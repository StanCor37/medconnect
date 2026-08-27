import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb, uniqueSuffix } from "../setup/testDb";
import { buildFixtures, type Fixtures } from "../setup/fixtures";
import {
  createAccountService,
  setPasswordService,
  setAccountStatus,
  deleteAccountService,
  AccountServiceError,
} from "@/lib/accounts/service";

describe("accounts service — invite, activate, suspend, delete", () => {
  let fx: Fixtures;
  let newUserEmail: string;
  const extraUserIds: string[] = [];
  const extraProviderIds: string[] = [];

  beforeAll(async () => {
    fx = await buildFixtures();
    newUserEmail = `new-hire-${uniqueSuffix()}@test.medconnect.invalid`;
  });

  afterAll(async () => {
    const user = await testDb.user.findUnique({ where: { email: newUserEmail } });
    if (user) {
      await testDb.auditEvent.deleteMany({ where: { targetId: user.id } });
      await testDb.session.deleteMany({ where: { userId: user.id } });
      await testDb.invitation.deleteMany({ where: { userId: user.id } });
      await testDb.user.delete({ where: { id: user.id } });
    }
    if (extraUserIds.length > 0) {
      await testDb.auditEvent.deleteMany({ where: { targetId: { in: extraUserIds } } });
      await testDb.session.deleteMany({ where: { userId: { in: extraUserIds } } });
      await testDb.invitation.deleteMany({ where: { userId: { in: extraUserIds } } });
      await testDb.user.deleteMany({ where: { id: { in: extraUserIds } } });
    }
    if (extraProviderIds.length > 0) {
      await testDb.provider.deleteMany({ where: { id: { in: extraProviderIds } } });
    }
    await fx.cleanup();
  });

  it("Client Admin A can invite a Provider User into the actively-connected Provider", async () => {
    const result = await testDb.$transaction((tx) =>
      createAccountService(
        tx,
        fx.authFor("clientAdminA"),
        {
          email: newUserEmail,
          firstName: "New",
          lastName: "Hire",
          role: "provider_user",
          providerId: fx.providerConnected.id,
        },
        "http://localhost:3000/login"
      )
    );
    expect(result.tempPasswordForDevRelay).toBeTruthy();

    const created = await testDb.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(created.status).toBe("invited");
    expect(created.providerId).toBe(fx.providerConnected.id);
  });

  it("inviting the same email again is rejected rather than creating a second account", async () => {
    await expect(
      testDb.$transaction((tx) =>
        createAccountService(
          tx,
          fx.authFor("clientAdminA"),
          {
            email: newUserEmail,
            firstName: "Dup",
            lastName: "Licate",
            role: "provider_user",
            providerId: fx.providerConnected.id,
          },
          "http://localhost:3000/login"
        )
      )
    ).rejects.toBeInstanceOf(AccountServiceError);

    const count = await testDb.user.count({ where: { email: newUserEmail } });
    expect(count).toBe(1);
  });

  it("Client Admin A cannot invite a Provider User for a Provider with no active relationship to their Client", async () => {
    await expect(
      testDb.$transaction((tx) =>
        createAccountService(
          tx,
          fx.authFor("clientAdminA"),
          {
            email: `intruder-${uniqueSuffix()}@test.medconnect.invalid`,
            firstName: "In",
            lastName: "Truder",
            role: "provider_user",
            providerId: fx.providerStandalone.id, // not connected to Client A
          },
          "http://localhost:3000/login"
        )
      )
    ).rejects.toThrow(/active relationship/);
  });

  it("setPasswordService rejects the wrong temp password", async () => {
    await expect(
      testDb.$transaction((tx) => setPasswordService(tx, newUserEmail, "definitely-wrong", "NewPassword123!"))
    ).rejects.toBeInstanceOf(AccountServiceError);
  });

  it("suspending an account returns the UPDATED status (regression test for the stale-return bug) and revokes sessions", async () => {
    const user = await testDb.user.findUniqueOrThrow({ where: { email: newUserEmail } });
    await testDb.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 1000 * 60 * 60) },
    });

    const updated = await testDb.$transaction((tx) =>
      setAccountStatus(tx, fx.authFor("clientAdminA"), user.id, "suspend")
    );
    expect(updated.status).toBe("suspended");
    expect(updated.suspendedAt).not.toBeNull();

    const activeSessions = await testDb.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(activeSessions).toBe(0);
  });

  it("deleteAccountService falls back to deactivation once the account has activity (not hard-deleted)", async () => {
    const user = await testDb.user.findUniqueOrThrow({ where: { email: newUserEmail } });
    const result = await testDb.$transaction((tx) => deleteAccountService(tx, fx.authFor("clientAdminA"), user.id));
    expect(result.hardDeleted).toBe(false);

    const stillExists = await testDb.user.findUnique({ where: { id: user.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.status).toBe("deactivated");
  });

  it("deleteAccountService HARD-deletes a freshly-invited account with zero activity", async () => {
    const throwawayEmail = `throwaway-${uniqueSuffix()}@test.medconnect.invalid`;
    const { userId } = await testDb.$transaction((tx) =>
      createAccountService(
        tx,
        fx.authFor("superAdmin"),
        {
          email: throwawayEmail,
          firstName: "Throw",
          lastName: "Away",
          role: "provider_user",
          providerId: fx.providerStandalone.id,
        },
        "http://localhost:3000/login"
      )
    );

    const result = await testDb.$transaction((tx) =>
      deleteAccountService(tx, fx.authFor("superAdmin"), userId)
    );
    expect(result.hardDeleted).toBe(true);

    const gone = await testDb.user.findUnique({ where: { id: userId } });
    expect(gone).toBeNull();
  });

  it("Super Admin can create a Client Admin account for a Client", async () => {
    const email = `new-admin-${uniqueSuffix()}@test.medconnect.invalid`;
    const result = await testDb.$transaction((tx) =>
      createAccountService(
        tx,
        fx.authFor("superAdmin"),
        { email, firstName: "New", lastName: "Admin", role: "client_admin", clientId: fx.clientA.id },
        "http://localhost:3000/login"
      )
    );
    extraUserIds.push(result.userId);

    const created = await testDb.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(created.role).toBe("client_admin");
    expect(created.clientId).toBe(fx.clientA.id);
    expect(created.providerId).toBeNull();
  });

  it("Super Admin cannot create a Provider User for a connected (non-standalone) Provider", async () => {
    await expect(
      testDb.$transaction((tx) =>
        createAccountService(
          tx,
          fx.authFor("superAdmin"),
          {
            email: `blocked-${uniqueSuffix()}@test.medconnect.invalid`,
            firstName: "Should",
            lastName: "Fail",
            role: "provider_user",
            providerId: fx.providerConnected.id, // mode: client_connected
          },
          "http://localhost:3000/login"
        )
      )
    ).rejects.toThrow(/standalone Providers they created/);
  });

  it("Super Admin cannot create a Provider User for a standalone Provider it did not itself create", async () => {
    const s = uniqueSuffix();
    const foreignStandaloneProvider = await testDb.provider.create({
      data: {
        legalName: `Test Foreign Standalone Provider ${s}`,
        normalizedName: `test foreign standalone provider ${s}`,
        mode: "standalone",
        country: "RS",
        officialRegistrationNumber: `TEST-REG-FOREIGN-${s}`,
        createdByClientAdminId: fx.clientAdminA.id,
        createdBySuperAdminId: null,
      },
    });
    extraProviderIds.push(foreignStandaloneProvider.id);

    await expect(
      testDb.$transaction((tx) =>
        createAccountService(
          tx,
          fx.authFor("superAdmin"),
          {
            email: `blocked-${uniqueSuffix()}@test.medconnect.invalid`,
            firstName: "Should",
            lastName: "Fail",
            role: "provider_user",
            providerId: foreignStandaloneProvider.id,
          },
          "http://localhost:3000/login"
        )
      )
    ).rejects.toThrow(/standalone Providers they created/);
  });
});
