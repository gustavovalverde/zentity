"use client";

import type { Session } from "better-auth";

import {
  useAuth,
  useListSessions,
  useRevokeOtherSessions,
  useRevokeSession,
  useSession,
} from "@better-auth-ui/react";
import { MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/date-format";

/** View and revoke the account's active sessions across devices. */
export function SessionsCard() {
  const { authClient } = useAuth();
  const { data: current } = useSession(authClient);
  const sessions = useListSessions(authClient);
  const revokeOthers = useRevokeOtherSessions(authClient, {
    onSuccess: () => toast.success("Signed out of your other devices"),
    onError: (error) =>
      toast.error("Couldn't sign out your other devices", {
        description: error.message,
      }),
  });

  const currentId = current?.session.id;
  const ordered = [...(sessions.data ?? [])].sort(
    (a, b) => Number(b.id === currentId) - Number(a.id === currentId)
  );
  const hasOtherSessions = ordered.some((session) => session.id !== currentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
        <CardDescription>
          View and manage your active sessions across devices. Revoke any
          session you don&apos;t recognize.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Couldn&apos;t load your sessions. Refresh the page to try again.
            </AlertDescription>
          </Alert>
        ) : null}
        {sessions.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <ItemGroup className="gap-3">
            {ordered.map((session) => (
              <SessionItem
                isCurrent={session.id === currentId}
                key={session.id}
                session={session}
              />
            ))}
          </ItemGroup>
        )}
      </CardContent>
      {hasOtherSessions ? (
        <CardFooter className="justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                disabled={revokeOthers.isPending}
                size="sm"
                variant="outline"
              >
                {revokeOthers.isPending ? <Spinner /> : null}
                Sign Out Other Devices
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign out other devices?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every session except this one ends. You stay signed in here.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => revokeOthers.mutate()}>
                  Sign Out Other Devices
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function SessionItem({
  isCurrent,
  session,
}: Readonly<{ isCurrent: boolean; session: Session }>) {
  const { authClient, basePaths, navigate, viewPaths } = useAuth();
  const revoke = useRevokeSession(authClient, {
    onError: (error) =>
      toast.error("Couldn't revoke the session", {
        description: error.message,
      }),
  });

  // Zentity stores no user agent or IP address with a session, so a session
  // is told apart by when it started and when it lapses.
  const details = `Signed in ${formatDate(session.createdAt, "recently")} · Expires ${formatDate(session.expiresAt, "soon")}`;

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <MonitorSmartphone />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {isCurrent ? "This browser" : "Another session"}
          {isCurrent ? (
            <Badge variant="secondary">Current Session</Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription>{details}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          disabled={revoke.isPending}
          onClick={() =>
            isCurrent
              ? navigate({ to: `${basePaths.auth}/${viewPaths.auth.signOut}` })
              : revoke.mutate({ token: session.token })
          }
          size="sm"
          variant="outline"
        >
          {revoke.isPending ? <Spinner /> : null}
          {isCurrent ? "Sign Out" : "Revoke"}
        </Button>
      </ItemActions>
    </Item>
  );
}
