"use client";

import type { ReactNode } from "react";

import { Key, Shield, Trash2, User } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SettingsTabsProps {
  readonly securityContent: ReactNode;
  readonly dataContent: ReactNode;
  readonly accountContent: ReactNode;
}

export function SettingsTabs({
  securityContent,
  dataContent,
  accountContent,
}: SettingsTabsProps) {
  return (
    <Tabs className="w-full" defaultValue="security">
      <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:grid-cols-none">
        <TabsTrigger className="gap-1.5" value="security">
          <Key className="h-4 w-4" />
          <span className="hidden sm:inline">Security</span>
        </TabsTrigger>
        <TabsTrigger className="gap-1.5" value="data">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline">Data</span>
        </TabsTrigger>
        <TabsTrigger className="gap-1.5" value="account">
          <Shield className="h-4 w-4" />
          <span className="hidden sm:inline">Account</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent className="mt-6 space-y-6" value="security">
        {securityContent}
      </TabsContent>

      <TabsContent className="mt-6 space-y-6" value="data">
        {dataContent}
      </TabsContent>

      <TabsContent className="mt-6 space-y-6" value="account">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
          <div className="mb-4 flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            <span className="font-medium text-sm">Danger Zone</span>
          </div>
          {accountContent}
        </div>
      </TabsContent>
    </Tabs>
  );
}
