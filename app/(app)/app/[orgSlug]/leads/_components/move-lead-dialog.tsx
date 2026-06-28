"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  stageName: string;
  onConfirm: (value: number) => void;
  onCancel: () => void;
};

export function MoveLeadDialog({ open, stageName, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState("");

  const parsedValue = Number.parseFloat(value.replace(",", "."));
  const isValid = value.length > 0 && !Number.isNaN(parsedValue) && parsedValue > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(parsedValue);
    setValue("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para &quot;{stageName}&quot;</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="sale-value">Valor da venda (R$)</Label>
          <Input
            id="sale-value"
            type="number"
            min="0"
            step="0.01"
            placeholder="Ex: 1500.00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!isValid}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
