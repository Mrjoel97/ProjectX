// GENERATED FILE. Do not edit. Offline compiler schema design-knowledge-v1; compiler aeb133e61bff104d3635ee80c4c925bff5ba6f0c1eab4bf19b4344068dc4436e; bundle d818e4d9ab6fcf85b3725d578edf2fbace642dc0472e1d94922c030f7df016a8; input cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8.
export const designKnowledgeBundle = {
  "schemaVersion": 1,
  "compilerSchemaVersion": "design-knowledge-v1",
  "inputHash": "cc6ba41543fec188a611c9c66c76cad1e97b46ad132374c68b33c0a43b15bec8",
  "records": [
    {
      "id": "landing-proof",
      "kind": "catalogueCopy",
      "data": {
        "label": "Landing Proof",
        "fields": [
          "headline",
          "summary",
          "benefit",
          "publisher-proof",
          "clear-action"
        ],
        "proofRequired": true
      }
    },
    {
      "id": "product-copy",
      "kind": "catalogueCopy",
      "data": {
        "label": "Product Copy",
        "fields": [
          "name",
          "description",
          "features",
          "audience",
          "tone"
        ],
        "proofRequired": true
      }
    },
    {
      "id": "minimal-swiss",
      "kind": "designProfile",
      "data": {
        "label": "Minimal Swiss",
        "style": "spacious-grid",
        "variance": 5,
        "motion": 3,
        "density": 2,
        "accessibility": "high-contrast-keyboard-focus"
      }
    },
    {
      "id": "forms-first",
      "kind": "formRule",
      "data": {
        "label": "Forms First",
        "requirement": "visible-labels-keyboard-focus-associated-errors"
      }
    },
    {
      "id": "hero-features-cta",
      "kind": "landingPattern",
      "data": {
        "label": "Hero Features CTA",
        "sections": [
          "hero",
          "value",
          "features",
          "action",
          "footer"
        ],
        "cta": "hero-and-lower-page",
        "accessibility": "focus-visible-reduced-motion"
      }
    },
    {
      "id": "trust-commerce",
      "kind": "paletteProfile",
      "data": {
        "label": "Trust Commerce",
        "productType": "e-commerce",
        "primaryRole": "calm-success",
        "accentRole": "clear-action"
      }
    },
    {
      "id": "taste-baseline",
      "kind": "tasteDial",
      "data": {
        "label": "Taste Baseline",
        "variance": 8,
        "motion": 6,
        "density": 4,
        "preservation": "brief-first-and-preserve-existing-brand-assets"
      }
    },
    {
      "id": "modern-professional",
      "kind": "typographyProfile",
      "data": {
        "label": "Modern Professional",
        "heading": "Poppins",
        "body": "Open Sans",
        "mood": "clear-approachable"
      }
    }
  ]
} as const;
export type DesignKnowledgeBundle = typeof designKnowledgeBundle;
