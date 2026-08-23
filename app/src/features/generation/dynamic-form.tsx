"use client";

import * as React from "react";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { FormField, FormSchema } from "@/contracts/application";
import type { FormValues } from "@/contracts/generation";

/**
 * 动态表单渲染器：按 FormSchema 渲染字段，受控于 formValues。
 * 支持 text/textarea/select/radio/multiselect/checkbox/slider/image(占位)/条件显示。
 */
export function DynamicForm({
  schema,
  values,
  errors,
  onChange,
}: {
  schema: FormSchema;
  values: FormValues;
  errors: Record<string, string>;
  onChange: (key: string, value: unknown) => void;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, FormField[]>();
    for (const field of schema) {
      const g = field.group ?? "其它";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(field);
    }
    return [...map.entries()];
  }, [schema]);

  return (
    <div className="space-y-5">
      {groups.map(([groupName, fields], gi) => (
        <div key={groupName}>
          {gi > 0 && <div className="mb-4 border-t border-[var(--color-border)]" />}
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {groupName}
          </p>
          <div className="space-y-3">
            {fields.map((field) => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={values[field.key]}
                error={errors[field.key]}
                allValues={values}
                onChange={(v) => onChange(field.key, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  error,
  allValues,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  allValues: FormValues;
  onChange: (value: unknown) => void;
}) {
  // 条件显示
  if (field.type === "slider" || field.type === "checkbox") {
    const sw = field.showWhen;
    if (sw) {
      const actual = String(allValues[sw.field] ?? "");
      if (actual !== sw.equals) return null;
    }
  }

  const errorId = `${field.key}-error`;

  return (
    <div>
      {field.type !== "checkbox" && (
        <Label htmlFor={field.key} required={field.required}>
          {field.label}
        </Label>
      )}
      <FieldControl
        field={field}
        value={value}
        errorId={errorId}
        onChange={onChange}
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldControl({
  field,
  value,
  errorId,
  onChange,
}: {
  field: FormField;
  value: unknown;
  errorId: string;
  onChange: (value: unknown) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <Input
          id={field.key}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          aria-invalid={!!errorId}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <Textarea
          id={field.key}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <Select
          id={field.key}
          value={(value as string) ?? field.defaultValue}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "radio":
      return (
        <SegmentedControl
          id={field.key}
          options={field.options}
          value={(value as string) ?? field.defaultValue}
          onChange={onChange}
        />
      );
    case "multiselect":
      return (
        <MultiSelectControl
          field={field}
          value={(value as string[]) ?? field.defaultValues}
          onChange={onChange}
        />
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          {field.label}
        </label>
      );
    case "slider":
      return (
        <SliderControl field={field} value={value} onChange={onChange} />
      );
    case "image":
      return (
        <ImageUploadPlaceholder field={field} value={value} onChange={onChange} />
      );
    default:
      return null;
  }
}

function SegmentedControl({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            value === o.value
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiSelectControl({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: "multiselect" }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (value.length < field.maxItems) onChange([...value, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {field.options.map((o) => {
        const active = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(o.value)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SliderControl({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: "slider" }>;
  value: unknown;
  onChange: (v: number) => void;
}) {
  const v = typeof value === "number" ? value : field.defaultValue;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
        aria-label={field.label}
      />
      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-[var(--color-text)]">
        {v}
        {field.unit}
      </span>
    </div>
  );
}

/** 阶段1：上传只做视觉占位与本地预览，阶段2接服务端 presign。 */
function ImageUploadPlaceholder({
  field,
  value,
  onChange,
}: {
  field: Extract<FormField, { type: "image" }>;
  value: unknown;
  onChange: (v: unknown[]) => void;
}) {
  const items = Array.isArray(value) ? (value as Array<Record<string, string>>) : [];
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const next = [...items];
    for (const file of [...files]) {
      if (next.length >= field.max) break;
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", file.name);
        formData.append("role", field.roles?.[0] ?? "product");
        const res = await fetch("/api/uploads", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok || !json.data) {
          console.error("上传失败:", json.error);
          continue;
        }
        next.push({
          uploadId: json.data.id,
          objectKey: json.data.objectKey,
          previewUrl: `/api/storage/${encodeURIComponent(json.data.objectKey)}`,
        });
      } catch (err) {
        console.error("上传错误:", err);
      }
    }
    onChange(next);
    setUploading(false);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="relative size-16 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={`素材 ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              aria-label={`删除素材 ${i + 1}`}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="absolute right-0 top-0 grid size-5 place-items-center rounded-bl-lg bg-black/60 text-white hover:bg-black/80"
            >
              ×
            </button>
          </div>
        ))}
        {uploading && (
          <div className="grid size-16 place-items-center rounded-lg border border-dashed border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
            上传中...
          </div>
        )}
        {items.length < field.max && !uploading && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="grid size-16 place-items-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            aria-label={`添加${field.label}`}
          >
            <span className="text-xl leading-none">+</span>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={field.max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
        {field.min > 0 ? `至少 ${field.min} 张，` : ""}最多 {field.max} 张 · JPEG/PNG/WebP
        {field.allowLibrary && " · 可从图库选择"}
      </p>
    </div>
  );
}
