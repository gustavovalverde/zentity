import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { users, walletAddresses } from "@/lib/db/schema/auth";
import {
  invitations,
  members,
  organizations,
} from "@/lib/db/schema/organization";

const NON_ISO_DEFAULT = /datetime\(|CURRENT_TIMESTAMP/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("text timestamp defaults", () => {
  it("never defaults a column to datetime('now') or CURRENT_TIMESTAMP", async () => {
    const tables = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table'`
    );
    const offenders: string[] = [];
    for (const { name: table } of tables) {
      const columns = await db.all<{ name: string; dflt_value: string | null }>(
        sql`select name, dflt_value from pragma_table_info(${table})`
      );
      for (const column of columns) {
        if (NON_ISO_DEFAULT.test(String(column.dflt_value))) {
          offenders.push(`${table}.${column.name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("writes ISO timestamps for wallet, organization, member, and invitation rows", async () => {
    const userId = randomUUID();
    const orgId = randomUUID();
    await db.insert(users).values({
      id: userId,
      name: "Timestamp Test",
      email: `${userId}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      await db.insert(walletAddresses).values({
        id: randomUUID(),
        userId,
        address: `0x${userId.replaceAll("-", "")}`,
        chainId: 1,
      });
      await db
        .insert(organizations)
        .values({ id: orgId, name: "Org", slug: orgId });
      await db.insert(members).values({
        id: randomUUID(),
        organizationId: orgId,
        userId,
      });
      await db.insert(invitations).values({
        id: randomUUID(),
        organizationId: orgId,
        email: "invitee@example.test",
        role: "member",
        inviterId: userId,
      });

      const [wallet] = await db
        .select()
        .from(walletAddresses)
        .where(eq(walletAddresses.userId, userId));
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId));
      const [member] = await db
        .select()
        .from(members)
        .where(eq(members.organizationId, orgId));
      const [invitation] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.organizationId, orgId));

      for (const createdAt of [
        wallet?.createdAt,
        org?.createdAt,
        member?.createdAt,
        invitation?.createdAt,
      ]) {
        expect(createdAt).toMatch(ISO_TIMESTAMP);
      }
    } finally {
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
  });
});
