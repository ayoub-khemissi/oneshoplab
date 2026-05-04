'use client';

import { Pagination } from '@heroui/react';
import { useState } from 'react';
import { CopyButton } from './copy-button';

export interface SocialPost {
  tone: string;
  content: string;
}

interface SocialPostsSectionProps {
  label: string;
  posts: SocialPost[];
  copyLabel: string;
  copiedLabel: string;
  /** Optional regenerate slot — typically a small <form>+<button> that
   *  triggers a server action to re-run only this section. */
  regenAction?: React.ReactNode;
  /** Hide all action buttons (copy, regenerate) — used when the visitor is
   *  not the audit owner and only has read access. */
  readOnly?: boolean;
}

/**
 * Renders 3 social post variations with HeroUI pagination + a Copy button
 * that always copies the currently visible post. The pagination sits just to
 * the LEFT of the action buttons so the layout stays consistent with other
 * sections (label left, controls right).
 */
export function SocialPostsSection({
  label,
  posts,
  copyLabel,
  copiedLabel,
  regenAction,
  readOnly = false
}: SocialPostsSectionProps) {
  const safePosts = posts.length > 0 ? posts : [{ tone: '', content: '' }];
  const [index, setIndex] = useState(0);
  const clamped = Math.min(index, safePosts.length - 1);
  const current = safePosts[clamped];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          {label}
          {current.tone ? (
            <span className="ml-2 normal-case tracking-normal text-[var(--accent)] font-mono">
              · {current.tone}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {safePosts.length > 1 ? (
            <Pagination size="sm" className="w-auto">
              <Pagination.Content>
                {safePosts.map((_, i) => (
                  <Pagination.Item key={i}>
                    <Pagination.Link
                      isActive={i === clamped}
                      onPress={() => setIndex(i)}
                      aria-label={`Post ${i + 1}`}
                    >
                      {i + 1}
                    </Pagination.Link>
                  </Pagination.Item>
                ))}
              </Pagination.Content>
            </Pagination>
          ) : null}
          {readOnly ? null : (
            <CopyButton
              value={current.content}
              label={copyLabel}
              copiedLabel={copiedLabel}
            />
          )}
          {readOnly ? null : regenAction}
        </div>
      </div>
      <pre className="text-sm whitespace-pre-wrap font-sans bg-[var(--default)] rounded-md p-3 leading-relaxed">
        {current.content}
      </pre>
    </div>
  );
}
