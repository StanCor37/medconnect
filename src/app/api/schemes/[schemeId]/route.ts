import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/authz/withAuth";
import { can } from "@/lib/authz/can";
import { scopedSchemeWhere } from "@/lib/rules/scoping";
import { loadSchemeResource } from "@/lib/schemes/loadSchemeResource";
import { deleteSchemeService, SchemeServiceError, schemeErrorStatus } from "@/lib/schemes/service";

export const GET = withAuth(
  async (req: NextRequest, auth, tx, { params }: { params: Promise<{ schemeId: string }> }) => {
    const { schemeId } = await params;
    const scheme = await tx.validationScheme.findFirst({
      where: { AND: [{ id: schemeId }, scopedSchemeWhere(auth)] },
      include: {
        currentVersion: { include: { schemeRules: { include: { ruleVersion: true } }, documentTypeDefinitions: true } },
      },
    });
    if (!scheme) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "scheme.view", { type: "ValidationScheme" });
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    // Optional: fetch a specific NON-current draft version's own Rules/Document
    // Types — needed by the admin UI to edit a draft created by
    // createNextDraftSchemeVersionService, which deliberately never moves
    // currentVersionId until publish, so `currentVersion` above can't reach it.
    const versionId = new URL(req.url).searchParams.get("versionId");
    let editableVersion = null;
    if (versionId) {
      editableVersion = await tx.validationSchemeVersion.findFirst({
        where: { id: versionId, schemeId },
        include: { schemeRules: { include: { ruleVersion: true } }, documentTypeDefinitions: true },
      });
    }

    return Response.json({ ...scheme, editableVersion });
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, auth, tx, { params }: { params: Promise<{ schemeId: string }> }) => {
    const { schemeId } = await params;
    const found = await loadSchemeResource(tx, schemeId);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    const decision = can(auth, "scheme.delete", found.resource);
    if (!decision.allowed) return Response.json({ error: "forbidden" }, { status: decision.status });

    try {
      const result = await deleteSchemeService(tx, auth, schemeId);
      return Response.json(result);
    } catch (err) {
      if (err instanceof SchemeServiceError) {
        return Response.json({ error: err.code, message: err.message }, { status: schemeErrorStatus(err.code) });
      }
      throw err;
    }
  }
);
