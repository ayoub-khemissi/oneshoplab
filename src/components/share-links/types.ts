export interface ShareLinkRow {
  id: string;
  label: string | null;
  showOnHome: boolean;
  /** Admin-curated position in the home showcase. NULL = unranked. */
  homeOrder?: number | null;
  createdAt: Date | string;
  productSourceIds: string[];
}

export interface CandidateProduct {
  sourceId: string;
  title: string;
  hasTitle: boolean;
  hasDescription: boolean;
  hasTags: boolean;
  hasImages: boolean;
}
