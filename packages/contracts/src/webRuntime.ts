/** Closed, serializable contracts for tenant-owned sites and landing pages. */

// v2 adds the inert storefront catalogue presentation node. Stored Phase 48 artifacts retain
// their original renderer identity and bytes; callers must never regenerate them in place.
export const WEB_RENDERER_VERSION = "web-runtime-v2" as const;
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const ABUSE_BUCKET_RETENTION_MS = 15 * 60 * 1000;

export const WEB_RUNTIME_LIMITS = {
  maxDocumentBytes: 256 * 1024,
  maxDepth: 4,
  maxNodes: 100,
  maxPages: 20,
  maxNavigationItems: 20,
  maxUrls: 64,
  maxTextLength: 4_000,
  maxShortTextLength: 256,
  maxSlugLength: 64,
  maxIdLength: 64,
  maxStorageRefLength: 256,
  maxConsentLength: 512,
  maxAttributionLength: 128,
  maxBrandNameLength: 128,
} as const;

export type ProjectKind = "site" | "landing" | "storefront";
export type ProjectStatus = "draft" | "approved" | "published" | "unpublished" | "publish_failed";
export type DomainMode = "platform_path" | "custom_pending" | "custom_active";
export type PublicationAction = "publish" | "update" | "unpublish" | "rollback";
export type PublicationStatus = "pending" | "published" | "failed" | "rolled_back" | "unpublished";
export type PublicReadState =
  | "published"
  | "not_found"
  | "unpublished"
  | "invalid_host"
  | "render_failed";
export type FormOutcome =
  | "accepted"
  | "duplicate"
  | "invalid"
  | "consent_required"
  | "suppressed"
  | "rate_limited"
  | "unavailable";
export type WebMetricKind = "page_view" | "cta_click" | "form_accepted" | "form_rejected";

export type HostingDeclaration = {
  readonly hosting:
    | "pikar_platform_path"
    | "tenant_custom_domain_pending"
    | "tenant_custom_domain_verified";
  readonly source: "tenant_structured_content";
};

export type PublicationReceipt = {
  readonly action: PublicationAction;
  readonly status: PublicationStatus;
  readonly projectId?: string;
  readonly version?: number;
  readonly contentHash?: string;
  readonly failure?: "not_approved" | "stale_revision" | "render_failed" | "unavailable";
};

export type PublicReadResult =
  | {
      readonly state: "published";
      readonly html: string;
      readonly version: number;
      readonly contentHash: string;
    }
  | {
      readonly state: "not_found" | "unpublished" | "invalid_host" | "render_failed";
      readonly reason?: string;
    };

export type SafeRefusal = {
  readonly ok: false;
  readonly kind: "refused";
  readonly code:
    | "invalid_document"
    | "invalid_route"
    | "invalid_form"
    | "consent_required"
    | "unpublished"
    | "invalid_host"
    | "not_found"
    | "stale_revision"
    | "not_approved";
};

export type SafeError = {
  readonly ok: false;
  readonly kind: "error";
  readonly code: "unavailable" | "render_failed" | "rate_limited";
};

export type WebRouteContext = {
  readonly slug: string;
  readonly page: string;
};

export type WebBrand = {
  readonly name: string;
  readonly primaryColor?: string;
  readonly logoStorageRef?: string;
};

export type WebNavigationItem = {
  readonly label: string;
  readonly path: string;
};

export type CtaTarget =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "https"; readonly url: string };

export type WebAttribution = {
  readonly source?: string;
  readonly medium?: string;
  readonly campaign?: string;
};

export type WebFormField = "email" | "name" | "company";

export type WebShellNode = { readonly kind: "shell"; readonly heading?: string };
export type WebNavigationNode = {
  readonly kind: "navigation";
  readonly items: readonly WebNavigationItem[];
};
export type WebHeroNode = {
  readonly kind: "hero";
  readonly eyebrow?: string;
  readonly heading: string;
  readonly body?: string;
};
export type WebTextNode = { readonly kind: "text"; readonly text: string };
export type WebMediaNode = {
  readonly kind: "media";
  readonly storageRef: string;
  readonly alt: string;
};
/**
 * A publisher-authored catalogue item. This is deliberately a presentation-only shape: it has
 * no SKU, quantity, stock, purchase target, merchant, tax, shipping, refund, order or fulfilment
 * state. Phase 50 owns those concepts.
 */
export type WebCatalogueItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly imageStorageRef?: string;
  readonly displayPriceText?: string;
  readonly availabilityLabel?: string;
};
export type WebCatalogueNode = {
  readonly kind: "catalogue";
  readonly heading?: string;
  readonly items: readonly WebCatalogueItem[];
};
export type WebCtaNode = {
  readonly kind: "cta";
  readonly id: string;
  readonly label: string;
  readonly target: CtaTarget;
  readonly analytics?: boolean;
};
export type WebFormNode = {
  readonly kind: "form";
  readonly id: string;
  readonly heading?: string;
  readonly fields: readonly WebFormField[];
  readonly consent: string;
  readonly attribution?: WebAttribution;
};
export type WebSectionNode = {
  readonly kind: "section";
  readonly id: string;
  readonly heading?: string;
  readonly children: readonly WebContentNode[];
};
export type WebFooterNode = { readonly kind: "footer"; readonly text: string };

export type WebContentNode =
  | WebHeroNode
  | WebTextNode
  | WebMediaNode
  | WebCatalogueNode
  | WebCtaNode
  | WebFormNode
  | WebSectionNode;
export type WebNode = WebShellNode | WebNavigationNode | WebContentNode | WebFooterNode;
export type WebDocumentNode = WebNode;
export type MetricKind = WebMetricKind;
export type HostingSource = HostingDeclaration["source"];
export type HostingMode = HostingDeclaration["hosting"];
export type WebDocumentInput = WebDocument;

export type WebPage = {
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly nodes: readonly WebNode[];
};

export type WebDocument = {
  readonly kind: ProjectKind;
  readonly title: string;
  readonly description?: string;
  readonly brand: WebBrand;
  readonly navigation: readonly WebNavigationItem[];
  readonly pages: readonly WebPage[];
  readonly footer?: WebFooterNode;
};

export type RendererIdentity = {
  readonly rendererVersion: string;
  readonly contentHash: string;
  readonly byteLength: number;
};

/** Metric counts are raw requests; they are not unique people or conversions. */
export type WebMetricAggregate = {
  readonly kind: WebMetricKind;
  readonly count: number;
  readonly windowStartedAt: number;
  readonly windowEndsAt: number;
};

export type WebFormInput = {
  readonly email: string;
  readonly name?: string;
  readonly company?: string;
  readonly consent: boolean;
  readonly attribution?: WebAttribution;
  readonly idempotencyKey: string;
};

export type WebFormResult =
  | { readonly ok: true; readonly outcome: "accepted" | "duplicate" }
  | { readonly ok: false; readonly outcome: Exclude<FormOutcome, "accepted" | "duplicate"> };

export const MAX_WEB_DOCUMENT_BYTES = WEB_RUNTIME_LIMITS.maxDocumentBytes;
export const MAX_WEB_DEPTH = WEB_RUNTIME_LIMITS.maxDepth;
export const MAX_WEB_NODES = WEB_RUNTIME_LIMITS.maxNodes;
export const MAX_WEB_PAGES = WEB_RUNTIME_LIMITS.maxPages;
export const MAX_WEB_URLS = WEB_RUNTIME_LIMITS.maxUrls;
