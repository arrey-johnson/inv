"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createCustomerAction } from "@/app/(app)/sales/customers/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { EMPTY_CUSTOMER } from "@/lib/validations/customer";
import { CUSTOMER_TYPES, type CustomerType } from "@/types/database";
import type { BuilderCustomer } from "./types";

const TYPE_LABELS: Record<CustomerType, string> = {
  company: "Company",
  individual: "Individual",
  government: "Government",
  ngo: "NGO",
};

export function QuickAddCustomerDialog({
  trigger,
  onCreated,
}: {
  trigger: ReactNode;
  onCreated: (customer: BuilderCustomer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("company");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [niu, setNiu] = useState("");
  const [city, setCity] = useState("Douala");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setName("");
    setCustomerType("company");
    setEmail("");
    setPhone("");
    setNiu("");
    setCity("Douala");
    setFieldErrors({});
  }

  function submit() {
    startTransition(async () => {
      const result = await createCustomerAction({
        ...EMPTY_CUSTOMER,
        customer_type: customerType,
        name,
        email,
        phone,
        niu,
        city,
        country: "Cameroon",
        default_currency: "XAF",
        is_active: true,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      onCreated(result.data.customer);
      toast.success("Customer created");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Quickly add a customer and select them on this document.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="qa-c-type">Type</Label>
            <NativeSelect
              id="qa-c-type"
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value as CustomerType)}
            >
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-c-name">Name</Label>
            <Input
              id="qa-c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              autoFocus
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qa-c-email">Email</Label>
              <Input id="qa-c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-c-phone">Phone</Label>
              <Input id="qa-c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="qa-c-niu">NIU</Label>
              <Input id="qa-c-niu" value={niu} onChange={(e) => setNiu(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-c-city">City</Label>
              <Input id="qa-c-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Add customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
