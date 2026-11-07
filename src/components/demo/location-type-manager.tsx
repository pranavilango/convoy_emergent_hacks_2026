"use client";

import { useState, type FormEvent } from "react";

import { nextUnusedColor } from "@/lib/demo/colors";
import { MAX_TYPE_NAME_LENGTH, typeNameError } from "@/lib/demo/reducer";
import { demoActions } from "@/lib/demo/store";
import type { Location, LocationType } from "@/lib/demo/types";

import { ColorPicker } from "./color-picker";
import { Button, FieldLabel, SectionLabel, Swatch, TextInput } from "./controls";
import { Select } from "./select";

type Mode =
  | { kind: "idle" }
  | { kind: "new" }
  | { kind: "edit"; id: string }
  | { kind: "delete"; id: string };

export function LocationTypeManager({
  types,
  locations,
}: {
  types: LocationType[];
  locations: Location[];
}) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const counts = new Map<string, number>();
  for (const l of locations) counts.set(l.typeId, (counts.get(l.typeId) ?? 0) + 1);

  const done = () => setMode({ kind: "idle" });

  return (
    <section aria-labelledby="types-heading" className="space-y-4">
      <h2 id="types-heading">
        <SectionLabel index="02" aside={`${types.length} ${types.length === 1 ? "type" : "types"}`}>
          Location types
        </SectionLabel>
      </h2>

      <ul className="divide-y divide-foreground/30 border-y border-foreground/30">
        {types.map((type) => {
          const count = counts.get(type.id) ?? 0;
          if (mode.kind === "edit" && mode.id === type.id) {
            return (
              <li key={type.id} className="py-4">
                <TypeForm
                  types={types}
                  initial={type}
                  submitLabel="Save"
                  onSubmit={(name, color) => {
                    demoActions.renameType(type.id, name);
                    demoActions.recolorType(type.id, color);
                    done();
                  }}
                  onCancel={done}
                  onDelete={() => setMode({ kind: "delete", id: type.id })}
                />
              </li>
            );
          }
          if (mode.kind === "delete" && mode.id === type.id) {
            return (
              <li key={type.id} className="py-4">
                <DeleteType
                  type={type}
                  count={count}
                  others={types.filter((t) => t.id !== type.id)}
                  onDone={done}
                />
              </li>
            );
          }
          return (
            <li key={type.id} className="flex items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <Swatch color={type.color} />
                <span className="truncate text-lg tracking-tight">{type.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-4">
                <span className="font-mono text-xs opacity-70" aria-label={`${count} locations`}>
                  {String(count).padStart(2, "0")}
                </span>
                <Button
                  variant="ghost"
                  className="font-mono text-[11px] uppercase tracking-wider"
                  onClick={() => setMode({ kind: "edit", id: type.id })}
                  aria-label={`Edit ${type.name}`}
                >
                  Edit
                </Button>
              </span>
            </li>
          );
        })}
        {types.length === 0 && (
          <li className="py-3 text-sm opacity-70">
            No types yet. Add one to start placing locations.
          </li>
        )}
      </ul>

      {mode.kind === "new" ? (
        <TypeForm
          types={types}
          initial={{ name: "", color: nextUnusedColor(types.map((t) => t.color)) }}
          submitLabel="Add type"
          onSubmit={(name, color) => {
            demoActions.addType(name, color);
            done();
          }}
          onCancel={done}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setMode({ kind: "new" })}>
          + New type
        </Button>
      )}
    </section>
  );
}

function TypeForm({
  types,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  types: LocationType[];
  initial: { id?: string; name: string; color: string };
  submitLabel: string;
  onSubmit: (name: string, color: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [touched, setTouched] = useState(false);
  const error = typeNameError(types, name, initial.id);
  const inputId = `type-name-${initial.id ?? "new"}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!error) onSubmit(name, color);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="space-y-4"
    >
      <div>
        <FieldLabel htmlFor={inputId}>Type name</FieldLabel>
        <TextInput
          id={inputId}
          autoFocus
          value={name}
          maxLength={MAX_TYPE_NAME_LENGTH}
          placeholder="e.g. Dark kitchen"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={touched && !!error}
          aria-describedby={touched && error ? `${inputId}-error` : undefined}
        />
        {touched && error && (
          <p id={`${inputId}-error`} className="mt-1 text-xs">
            {error}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <FieldLabel>Pin color</FieldLabel>
        <ColorPicker label="Pin color" value={color} onChange={setColor} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            className="ml-auto font-mono text-[11px] uppercase tracking-wider"
            onClick={onDelete}
          >
            Delete type
          </Button>
        )}
      </div>
    </form>
  );
}

function DeleteType({
  type,
  count,
  others,
  onDone,
}: {
  type: LocationType;
  count: number;
  others: LocationType[];
  onDone: () => void;
}) {
  const [target, setTarget] = useState(others[0]?.id);
  const noun = count === 1 ? "location uses" : "locations use";

  return (
    <div role="group" aria-label={`Delete ${type.name}`} className="space-y-4">
      <p className="text-sm">
        {count === 0 ? (
          <>
            Delete <strong className="font-semibold">{type.name}</strong>? No locations use it.
          </>
        ) : (
          <>
            {count} {noun} <strong className="font-semibold">{type.name}</strong>. Move{" "}
            {count === 1 ? "it" : "them"} to another type, or delete {count === 1 ? "it" : "them"}{" "}
            along with the type.
          </>
        )}
      </p>

      {count > 0 && others.length > 0 && (
        <Select
          label="Move locations to"
          value={target}
          onChange={setTarget}
          options={others.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {count > 0 && others.length > 0 && target && (
          <Button
            size="sm"
            onClick={() => {
              demoActions.removeType(type.id, target);
              onDone();
            }}
          >
            Move &amp; delete type
          </Button>
        )}
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            demoActions.removeType(type.id);
            onDone();
          }}
        >
          {count > 0 ? `Delete type + ${count}` : "Delete type"}
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
