import type { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/session";
import { withRls } from "@/lib/db";
import type { AuthContext } from "./can";

type RouteHandler<RouteCtx> = (
  req: NextRequest,
  auth: AuthContext,
  tx: Prisma.TransactionClient,
  routeCtx: RouteCtx
) => Promise<Response>;

/**
 * Wraps a Route Handler with: session resolution -> live account-status
 * check -> RLS transaction context -> the handler itself. No session at all
 * is a 401 ("not authenticated"); a valid session with a non-active account
 * is a 403 ("authenticated but forbidden") per Segment 1 §6.
 */
export function withAuth<RouteCtx = unknown>(handler: RouteHandler<RouteCtx>) {
  return async (req: NextRequest, routeCtx: RouteCtx) => {
    const user = await getCurrentUser();
    if (!user) {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (user.status !== "active") {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const auth: AuthContext = {
      userId: user.id,
      role: user.role,
      providerId: user.providerId,
      clientId: user.clientId,
      accountStatus: user.status,
    };

    return withRls(auth, (tx) => handler(req, auth, tx, routeCtx));
  };
}
