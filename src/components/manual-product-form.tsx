'use client';

import { Button, InputGroup, Label, Spinner, TextField } from '@heroui/react';
import { ImagePlus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import {
  createManualProductAction,
  deleteManualProductAction,
  updateManualProductAction
} from '@/lib/manual-product-actions';

const MAX_IMAGES = 12;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface ManualProductImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ManualProductFormInitial {
  projectId: string;
  productId?: string;
  title?: string;
  descriptionHtml?: string;
  tags?: string[];
  vendor?: string | null;
  productType?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: string | null;
  images?: ManualProductImage[];
}

/**
 * Combined create / edit form for a manual product. When initial
 * carries a productId we render the edit variant (with the delete
 * action); without it we wire to the create action.
 *
 * Images are uploaded one-by-one to /api/uploads/products as soon as
 * the user picks files. The returned R2 URLs are mirrored into a
 * hidden JSON-encoded input that the server action decodes — keeps
 * the form a single-submission flow.
 */
export function ManualProductForm({ initial }: { initial: ManualProductFormInitial }) {
  const t = useTranslations('Dashboard');
  const isEdit = Boolean(initial.productId);

  const [images, setImages] = useState<ManualProductImage[]>(initial.images ?? []);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks which submit button the user clicked — drives the
  // post-create redirect (plain detail page vs. auto-optimize).
  const intentRef = useRef<'create' | 'optimize'>('create');
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleSubmit(formData: FormData): void {
    formData.set('images', JSON.stringify(images));
    // Client-side gate so the user sees the missing-images error
    // immediately rather than round-tripping through the server.
    if (images.length === 0) {
      setFormError(t('addProductErrorMissingImages'));
      return;
    }
    setFormError(null);
    formData.set('intent', intentRef.current);
    startTransition(() => {
      const action = isEdit ? updateManualProductAction : createManualProductAction;
      void action(formData);
    });
  }

  function handleDelete(formData: FormData): void {
    if (!isEdit) return;
    const ok = window.confirm(t('editProductDeleteConfirm'));
    if (!ok) return;
    startDeleteTransition(() => {
      void deleteManualProductAction(formData);
    });
  }

  async function handleFiles(filesList: FileList | null): Promise<void> {
    if (!filesList || filesList.length === 0) return;
    setUploadError(null);

    const slotsLeft = MAX_IMAGES - images.length;
    if (slotsLeft <= 0) {
      setUploadError(t('addProductErrorTooManyImages'));
      return;
    }

    const files = Array.from(filesList).slice(0, slotsLeft);
    setUploading((n) => n + files.length);

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setUploadError(`${file.name}: > 8 MB`);
        setUploading((n) => n - 1);
        continue;
      }
      const fd = new FormData();
      fd.set('projectId', initial.projectId);
      fd.set('file', file);
      try {
        const res = await fetch('/api/uploads/products', {
          method: 'POST',
          body: fd
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setUploadError(err?.error ?? `HTTP ${res.status}`);
        } else {
          const json = (await res.json()) as { url: string };
          setImages((prev) => [...prev, { src: json.url, alt: null, width: null, height: null }]);
        }
      } catch (e) {
        setUploadError((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }

    // Reset input so re-selecting the same file fires the change event.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeImageAt(idx: number): void {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAltAt(idx: number, alt: string): void {
    setImages((prev) => prev.map((img, i) => (i === idx ? { ...img, alt: alt || null } : img)));
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={initial.projectId} />
      {initial.productId ? (
        <input type="hidden" name="productId" value={initial.productId} />
      ) : null}
      {/* JSON-encoded image list mirrored from React state. */}
      <input type="hidden" name="images" value={JSON.stringify(images)} />

      <TextField
        fullWidth
        isRequired
        name="title"
        defaultValue={initial.title ?? ''}
        maxLength={512}
        autoFocus={!isEdit}
      >
        <Label>{t('addProductTitleLabel')}</Label>
        <InputGroup>
          <InputGroup.Input placeholder={t('addProductTitlePlaceholder')} />
        </InputGroup>
      </TextField>

      <div className="flex flex-col gap-1.5">
        <Label className="text-sm" htmlFor="description-input">
          {t('addProductDescriptionLabel')}
        </Label>
        <textarea
          id="description-input"
          name="descriptionHtml"
          rows={6}
          maxLength={50_000}
          defaultValue={initial.descriptionHtml ?? ''}
          placeholder={t('addProductDescriptionPlaceholder')}
          className="bg-[var(--background)] border border-[var(--border)] rounded-md px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition resize-y min-h-[120px]"
        />
      </div>

      <TextField fullWidth name="tags" defaultValue={(initial.tags ?? []).join(', ')}>
        <Label>{t('addProductTagsLabel')}</Label>
        <InputGroup>
          <InputGroup.Input placeholder={t('addProductTagsPlaceholder')} />
        </InputGroup>
      </TextField>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TextField
          name="priceMin"
          type="number"
          defaultValue={initial.priceMin != null ? String(initial.priceMin) : ''}
        >
          <Label>{t('addProductPriceLabel')}</Label>
          <InputGroup>
            <InputGroup.Input placeholder="29.90" step="0.01" min="0" />
          </InputGroup>
        </TextField>
        <TextField name="currency" defaultValue={initial.currency ?? ''} maxLength={8}>
          <Label>{t('addProductCurrencyLabel')}</Label>
          <InputGroup>
            <InputGroup.Input placeholder="EUR" />
          </InputGroup>
        </TextField>
        <TextField name="vendor" defaultValue={initial.vendor ?? ''} maxLength={255}>
          <Label>{t('addProductVendorLabel')}</Label>
          <InputGroup>
            <InputGroup.Input placeholder="My brand" />
          </InputGroup>
        </TextField>
      </div>

      <TextField name="productType" defaultValue={initial.productType ?? ''} maxLength={255}>
        <Label>{t('addProductTypeLabel')}</Label>
        <InputGroup>
          <InputGroup.Input placeholder="T-shirt, mug, …" />
        </InputGroup>
      </TextField>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm">
            {t('addProductImagesLabel')}{' '}
            <span className="text-[var(--danger)]" aria-label="required" title="required">
              *
            </span>
          </Label>
          <span className="text-xs text-[var(--muted)] font-mono tabular-nums">
            {images.length} / {MAX_IMAGES}
          </span>
        </div>
        <p className="text-xs text-[var(--muted)]">{t('addProductImagesHint')}</p>

        {images.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((img, idx) => (
              <div
                key={`${img.src}-${idx}`}
                className="relative rounded-md border border-[var(--border)] overflow-hidden bg-[var(--default)]/30"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt={img.alt ?? ''}
                  className="w-full aspect-square object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImageAt(idx)}
                  aria-label="Remove image"
                  className="absolute top-1.5 right-1.5 inline-flex items-center justify-center size-6 rounded-full bg-[var(--background)]/90 backdrop-blur text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white shadow"
                >
                  <X className="size-3" aria-hidden />
                </button>
                <input
                  id={`product-image-alt-${idx}`}
                  type="text"
                  value={img.alt ?? ''}
                  onChange={(e) => updateAltAt(idx, e.target.value)}
                  placeholder="alt"
                  maxLength={255}
                  className="block w-full px-2 py-1 text-[10px] border-t border-[var(--border)] bg-[var(--background)] focus:outline-none"
                />
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isDisabled={images.length >= MAX_IMAGES || uploading > 0}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading > 0 ? <Spinner size="sm" /> : <ImagePlus className="size-4" />}
            {uploading > 0 ? `Uploading ${uploading}…` : <span>{t('addProductImagesLabel')}</span>}
          </Button>
          <input
            ref={fileInputRef}
            id="product-image-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => void handleFiles(e.target.files)}
          />
          {uploadError ? (
            <span className="text-xs text-[var(--danger)]" role="alert">
              {uploadError}
            </span>
          ) : null}
        </div>
      </div>

      {formError ? (
        <div
          role="alert"
          className="rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 p-3 text-sm text-[var(--danger)]"
        >
          {formError}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-[var(--border)]">
        {isEdit ? (
          <Button type="submit" variant="primary" isPending={isPending} isDisabled={uploading > 0}>
            <Upload className="size-4" />
            {t('editProductSubmit')}
          </Button>
        ) : (
          // Two-button submit: clicking either fires the same form
          // action, with the chosen `intent` flag setting the post-
          // create redirect. The primary CTA carries the "optimize
          // immediately" path because that's the high-value flow
          // for a manual store (most users will want AI rewrites).
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="submit"
              variant="secondary"
              isPending={isPending && intentRef.current === 'create'}
              isDisabled={uploading > 0 || (isPending && intentRef.current === 'optimize')}
              onClick={() => {
                intentRef.current = 'create';
              }}
            >
              <Upload className="size-4" />
              {t('addProductSubmit')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isPending={isPending && intentRef.current === 'optimize'}
              isDisabled={uploading > 0 || (isPending && intentRef.current === 'create')}
              onClick={() => {
                intentRef.current = 'optimize';
              }}
            >
              <Sparkles className="size-4" />
              {t('addProductSubmitOptimize')}
            </Button>
          </div>
        )}
        {isEdit ? (
          <form action={handleDelete}>
            <input type="hidden" name="projectId" value={initial.projectId} />
            <input type="hidden" name="productId" value={initial.productId ?? ''} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              isPending={isDeleting}
              className="text-[var(--danger)] hover:text-[var(--danger)]"
            >
              <Trash2 className="size-3.5" />
              {t('editProductDelete')}
            </Button>
          </form>
        ) : null}
      </div>
    </form>
  );
}
