"use client";

import type {
  CountryDocumentEntry,
  ZkPassportDocType,
} from "@/lib/identity/document/zkpassport-support";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { CircleFlag } from "react-circle-flags";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

const DOC_TYPE_LABELS: Record<ZkPassportDocType, string> = {
  passport: "Passport",
  id_card: "National ID",
  residence_permit: "Residence Permit",
};

const ALL_DOC_TYPES: ZkPassportDocType[] = [
  "id_card",
  "passport",
  "residence_permit",
];

function SupportBadge({ level }: Readonly<{ level: number }>) {
  if (level >= 1) {
    return <Badge variant="success">Full NFC Support</Badge>;
  }
  if (level >= 0.75) {
    return <Badge variant="success">Good NFC Support</Badge>;
  }
  if (level >= 0.5) {
    return <Badge variant="warning">Partial NFC Support</Badge>;
  }
  if (level >= 0.25) {
    return <Badge variant="warning">Limited NFC Support</Badge>;
  }
  return <Badge variant="outline">No NFC</Badge>;
}

interface CountryDocumentSelectorProps {
  countries: CountryDocumentEntry[];
  onSupportChange: (support: number | null) => void;
}

export function CountryDocumentSelector({
  countries,
  onSupportChange,
}: Readonly<CountryDocumentSelectorProps>) {
  const [open, setOpen] = useState(false);
  const [selectedAlpha3, setSelectedAlpha3] = useState<string | null>(null);
  const [selectedDocType, setSelectedDocType] =
    useState<ZkPassportDocType>("passport");

  const selectedCountry = selectedAlpha3
    ? countries.find((c) => c.alpha3 === selectedAlpha3)
    : null;

  const currentSupport = selectedCountry
    ? selectedCountry.support[selectedDocType]
    : null;

  function handleCountrySelect(alpha3: string) {
    setSelectedAlpha3(alpha3);
    setOpen(false);

    const country = countries.find((c) => c.alpha3 === alpha3);
    if (!country) {
      return;
    }

    setSelectedDocType("passport");
    onSupportChange(country.support.passport);
  }

  function handleDocTypeChange(docType: string) {
    const type = docType as ZkPassportDocType;
    setSelectedDocType(type);
    if (selectedCountry) {
      onSupportChange(selectedCountry.support[type]);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-medium text-sm">What document will you verify?</p>

      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-expanded={open}
            className="w-full justify-between"
            variant="outline"
          >
            {selectedCountry ? (
              <span className="flex items-center gap-2">
                <CircleFlag
                  countryCode={selectedCountry.alpha2.toLowerCase()}
                  crossOrigin="anonymous"
                  height={20}
                  width={20}
                />
                {selectedCountry.name}
              </span>
            ) : (
              "Select your country..."
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search country..." />
            <CommandList>
              <CommandEmpty>
                <div className="space-y-1">
                  <p>Country not listed?</p>
                  <p className="text-muted-foreground">
                    Document Scan works for all countries.
                  </p>
                </div>
              </CommandEmpty>
              <CommandGroup>
                {countries.map((country) => (
                  <CommandItem
                    key={country.alpha3}
                    keywords={[country.alpha3, country.alpha2.toUpperCase()]}
                    onSelect={() => handleCountrySelect(country.alpha3)}
                    value={country.name}
                  >
                    <CircleFlag
                      countryCode={country.alpha2.toLowerCase()}
                      crossOrigin="anonymous"
                      height={20}
                      width={20}
                    />
                    <span>{country.name}</span>
                    <Check
                      className={cn(
                        "ml-auto h-4 w-4",
                        selectedAlpha3 === country.alpha3
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedAlpha3 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Tabs
            className="min-w-0 flex-1 basis-full sm:basis-0"
            onValueChange={handleDocTypeChange}
            value={selectedDocType}
          >
            <TabsList className="grid w-full grid-cols-3">
              {ALL_DOC_TYPES.map((type) => (
                <TabsTrigger
                  className="text-xs sm:text-sm"
                  key={type}
                  value={type}
                >
                  {DOC_TYPE_LABELS[type]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {currentSupport != null && <SupportBadge level={currentSupport} />}
        </div>
      )}
    </div>
  );
}
