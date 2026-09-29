"use client";

import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { type FormEvent, useEffect, useState } from "react";

type Branch = {
  taxSourceRef: string;
  taxBasisPoints: number;
  refundPolicyRef: string;
  buyerRetentionRef: string;
};
type Physical = Branch & {
  shippingSourceRef: string;
  shippingMinor: number;
  returnsPolicyRef: string;
};
type Digital = Branch & {
  deliveryRef: string;
  revocationRef: string;
  noShipping: true;
};
type Policy = {
  id: string;
  tenantId: string;
  projectId: string;
  revision: number;
  sellerOfRecordRef: string;
  currency: string;
  countries: string[];
  taxRounding: "half_up";
  physical?: Physical;
  digital?: Digital;
};
const getLatestPolicy = makeFunctionReference<"query", { projectId: string }, Policy | null>(
  "tenantOrders:getLatestPolicy",
);
const configurePolicy = makeFunctionReference<
  "mutation",
  {
    projectId: string;
    expectedRevision: number;
    sellerOfRecordRef: string;
    currency: string;
    countries: string[];
    taxRounding: "half_up";
    physical?: Physical;
    digital?: Digital;
  },
  { policyId: string; revision: number }
>("tenantOrders:configurePolicy");
type Form = {
  sellerOfRecordRef: string;
  currency: string;
  countries: string;
  physicalEnabled: boolean;
  physicalShippingSourceRef: string;
  physicalShippingMinor: string;
  physicalReturnsPolicyRef: string;
  physicalTaxSourceRef: string;
  physicalTaxBasisPoints: string;
  physicalRefundPolicyRef: string;
  physicalBuyerRetentionRef: string;
  digitalEnabled: boolean;
  digitalDeliveryRef: string;
  digitalRevocationRef: string;
  digitalNoShipping: boolean;
  digitalTaxSourceRef: string;
  digitalTaxBasisPoints: string;
  digitalRefundPolicyRef: string;
  digitalBuyerRetentionRef: string;
};

const emptyForm = (): Form => ({
  sellerOfRecordRef: "",
  currency: "USD",
  countries: "",
  physicalEnabled: false,
  physicalShippingSourceRef: "",
  physicalShippingMinor: "",
  physicalReturnsPolicyRef: "",
  physicalTaxSourceRef: "",
  physicalTaxBasisPoints: "",
  physicalRefundPolicyRef: "",
  physicalBuyerRetentionRef: "",
  digitalEnabled: false,
  digitalDeliveryRef: "",
  digitalRevocationRef: "",
  digitalNoShipping: false,
  digitalTaxSourceRef: "",
  digitalTaxBasisPoints: "",
  digitalRefundPolicyRef: "",
  digitalBuyerRetentionRef: "",
});

function formFromPolicy(policy: Policy): Form {
  return {
    sellerOfRecordRef: policy.sellerOfRecordRef,
    currency: policy.currency,
    countries: policy.countries.join(", "),
    physicalEnabled: !!policy.physical,
    physicalShippingSourceRef: policy.physical?.shippingSourceRef ?? "",
    physicalShippingMinor: String(policy.physical?.shippingMinor ?? ""),
    physicalReturnsPolicyRef: policy.physical?.returnsPolicyRef ?? "",
    physicalTaxSourceRef: policy.physical?.taxSourceRef ?? "",
    physicalTaxBasisPoints: String(policy.physical?.taxBasisPoints ?? ""),
    physicalRefundPolicyRef: policy.physical?.refundPolicyRef ?? "",
    physicalBuyerRetentionRef: policy.physical?.buyerRetentionRef ?? "",
    digitalEnabled: !!policy.digital,
    digitalDeliveryRef: policy.digital?.deliveryRef ?? "",
    digitalRevocationRef: policy.digital?.revocationRef ?? "",
    digitalNoShipping: policy.digital?.noShipping === true,
    digitalTaxSourceRef: policy.digital?.taxSourceRef ?? "",
    digitalTaxBasisPoints: String(policy.digital?.taxBasisPoints ?? ""),
    digitalRefundPolicyRef: policy.digital?.refundPolicyRef ?? "",
    digitalBuyerRetentionRef: policy.digital?.buyerRetentionRef ?? "",
  };
}

const card = {
  display: "grid",
  gap: "1rem",
  padding: 24,
  border: "1px solid var(--rule)",
  borderRadius: 18,
  background: "var(--card)",
};
const input = {
  width: "100%",
  minHeight: 44,
  padding: "0.5rem 0.7rem",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  color: "var(--ink)",
  background: "var(--card)",
};
const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
  gap: "0.75rem",
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  min?: number;
  max?: number;
}) {
  return (
    <label style={{ display: "grid", gap: "0.3rem" }}>
      <span>{label}</span>
      <input
        style={input}
        type={type}
        min={min}
        max={max}
        step={type === "number" ? 1 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

const validRef = (value: string) => value.length <= 128 && value.trim().length > 0;
const whole = (value: string, max: number) => {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
};
const checkedNumber = (value: number | null): number => {
  if (value === null) throw new Error("INVALID_POLICY_NUMBER");
  return value;
};

/** Private merchant declarations only; this form never switches storefront or payment readiness. */
export function TenantPolicyEditor({ projectId }: { projectId: string }) {
  const policy = useQuery(getLatestPolicy, { projectId });
  const configure = useMutation(configurePolicy);
  const [form, setForm] = useState<Form>(emptyForm);
  const [loadedKey, setLoadedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (policy === undefined) return;
    const key = `${projectId}:${policy?.revision ?? 0}`;
    if (loadedKey === key) return;
    setForm(policy ? formFromPolicy(policy) : emptyForm());
    setLoadedKey(key);
  }, [policy, projectId, loadedKey]);

  const change = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (policy === undefined || busy) return;
    setNotice("");
    const countries = form.countries
      .split(",")
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean);
    const physicalShippingMinor = whole(form.physicalShippingMinor, Number.MAX_SAFE_INTEGER);
    const physicalTaxBasisPoints = whole(form.physicalTaxBasisPoints, 10_000);
    const digitalTaxBasisPoints = whole(form.digitalTaxBasisPoints, 10_000);
    if (
      !validRef(form.sellerOfRecordRef) ||
      !/^[A-Z]{3}$/.test(form.currency) ||
      countries.length < 1 ||
      countries.length > 249 ||
      countries.some((country) => !/^[A-Z]{2}$/.test(country)) ||
      new Set(countries).size !== countries.length ||
      (!form.physicalEnabled && !form.digitalEnabled) ||
      (form.physicalEnabled &&
        (!validRef(form.physicalShippingSourceRef) ||
          physicalShippingMinor === null ||
          !validRef(form.physicalReturnsPolicyRef) ||
          !validRef(form.physicalTaxSourceRef) ||
          physicalTaxBasisPoints === null ||
          !validRef(form.physicalRefundPolicyRef) ||
          !validRef(form.physicalBuyerRetentionRef))) ||
      (form.digitalEnabled &&
        (!form.digitalNoShipping ||
          !validRef(form.digitalDeliveryRef) ||
          !validRef(form.digitalRevocationRef) ||
          !validRef(form.digitalTaxSourceRef) ||
          digitalTaxBasisPoints === null ||
          !validRef(form.digitalRefundPolicyRef) ||
          !validRef(form.digitalBuyerRetentionRef)))
    ) {
      setNotice(
        "Complete every enabled goods policy, enter unique two-letter countries, and check whole-number amounts before saving.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await configure({
        projectId,
        expectedRevision: policy?.revision ?? 0,
        sellerOfRecordRef: form.sellerOfRecordRef,
        currency: form.currency,
        countries,
        taxRounding: "half_up",
        ...(form.physicalEnabled
          ? {
              physical: {
                shippingSourceRef: form.physicalShippingSourceRef,
                shippingMinor: checkedNumber(physicalShippingMinor),
                returnsPolicyRef: form.physicalReturnsPolicyRef,
                taxSourceRef: form.physicalTaxSourceRef,
                taxBasisPoints: checkedNumber(physicalTaxBasisPoints),
                refundPolicyRef: form.physicalRefundPolicyRef,
                buyerRetentionRef: form.physicalBuyerRetentionRef,
              },
            }
          : {}),
        ...(form.digitalEnabled
          ? {
              digital: {
                deliveryRef: form.digitalDeliveryRef,
                revocationRef: form.digitalRevocationRef,
                noShipping: true,
                taxSourceRef: form.digitalTaxSourceRef,
                taxBasisPoints: checkedNumber(digitalTaxBasisPoints),
                refundPolicyRef: form.digitalRefundPolicyRef,
                buyerRetentionRef: form.digitalBuyerRetentionRef,
              },
            }
          : {}),
      });
      setNotice(
        `Policy v${result.revision} saved for this private storefront. Checkout remains closed.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error && error.message.includes("STALE_REVISION")
          ? "This policy changed elsewhere. Review the latest version before saving again."
          : "Policy save refused. Check the required facts; nothing was published.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (policy === undefined) return <p role="status">Loading merchant policy…</p>;

  return (
    <form onSubmit={submit} aria-label="Merchant shop policy" style={card}>
      <header>
        <p className="caps-label" style={{ margin: 0 }}>
          Merchant policy
        </p>
        <h3 style={{ margin: "0.25rem 0" }}>Set the rules for your private shop</h3>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          {policy ? `Saved policy v${policy.revision}.` : "No policy saved yet."} These are your
          declarations, not verified tax or provider eligibility. Public checkout stays closed.
        </p>
      </header>
      <div style={grid}>
        <Field
          label="Seller-of-record reference"
          value={form.sellerOfRecordRef}
          onChange={(value) => change("sellerOfRecordRef", value)}
        />
        <Field
          label="Quote currency (three-letter code)"
          value={form.currency}
          onChange={(value) => change("currency", value.toUpperCase())}
        />
        <Field
          label="Allowed buyer countries (two-letter codes, comma separated)"
          value={form.countries}
          onChange={(value) => change("countries", value)}
        />
      </div>
      <p style={{ margin: 0, color: "var(--ink-soft)" }}>
        Tax is calculated in integer minor units using half-up rounding. Enter merchant-verified
        source references; Pikar-AI supplies no tax, shipping, refund or retention defaults.
      </p>
      <fieldset style={{ ...card, padding: 16 }}>
        <legend>Physical goods</legend>
        <label>
          <input
            type="checkbox"
            checked={form.physicalEnabled}
            onChange={(event) => change("physicalEnabled", event.target.checked)}
          />{" "}
          Configure physical sales
        </label>
        {form.physicalEnabled && (
          <div style={grid}>
            <Field
              label="Shipping source reference"
              value={form.physicalShippingSourceRef}
              onChange={(value) => change("physicalShippingSourceRef", value)}
            />
            <Field
              label="Shipping amount (minor units)"
              type="number"
              min={0}
              value={form.physicalShippingMinor}
              onChange={(value) => change("physicalShippingMinor", value)}
            />
            <Field
              label="Returns policy reference"
              value={form.physicalReturnsPolicyRef}
              onChange={(value) => change("physicalReturnsPolicyRef", value)}
            />
            <Field
              label="Physical tax source reference"
              value={form.physicalTaxSourceRef}
              onChange={(value) => change("physicalTaxSourceRef", value)}
            />
            <Field
              label="Physical tax basis points"
              type="number"
              min={0}
              max={10000}
              value={form.physicalTaxBasisPoints}
              onChange={(value) => change("physicalTaxBasisPoints", value)}
            />
            <Field
              label="Physical refund policy reference"
              value={form.physicalRefundPolicyRef}
              onChange={(value) => change("physicalRefundPolicyRef", value)}
            />
            <Field
              label="Physical buyer-retention reference"
              value={form.physicalBuyerRetentionRef}
              onChange={(value) => change("physicalBuyerRetentionRef", value)}
            />
          </div>
        )}
      </fieldset>
      <fieldset style={{ ...card, padding: 16 }}>
        <legend>Digital goods</legend>
        <label>
          <input
            type="checkbox"
            checked={form.digitalEnabled}
            onChange={(event) => change("digitalEnabled", event.target.checked)}
          />{" "}
          Configure digital sales
        </label>
        {form.digitalEnabled && (
          <div style={grid}>
            <Field
              label="Digital delivery reference"
              value={form.digitalDeliveryRef}
              onChange={(value) => change("digitalDeliveryRef", value)}
            />
            <Field
              label="Digital revocation reference"
              value={form.digitalRevocationRef}
              onChange={(value) => change("digitalRevocationRef", value)}
            />
            <label>
              <input
                type="checkbox"
                checked={form.digitalNoShipping}
                onChange={(event) => change("digitalNoShipping", event.target.checked)}
              />{" "}
              I confirm digital goods have zero shipping
            </label>
            <Field
              label="Digital tax source reference"
              value={form.digitalTaxSourceRef}
              onChange={(value) => change("digitalTaxSourceRef", value)}
            />
            <Field
              label="Digital tax basis points"
              type="number"
              min={0}
              max={10000}
              value={form.digitalTaxBasisPoints}
              onChange={(value) => change("digitalTaxBasisPoints", value)}
            />
            <Field
              label="Digital refund policy reference"
              value={form.digitalRefundPolicyRef}
              onChange={(value) => change("digitalRefundPolicyRef", value)}
            />
            <Field
              label="Digital buyer-retention reference"
              value={form.digitalBuyerRetentionRef}
              onChange={(value) => change("digitalBuyerRetentionRef", value)}
            />
          </div>
        )}
      </fieldset>
      <button
        type="submit"
        disabled={busy}
        style={{
          minHeight: 44,
          justifySelf: "start",
          border: 0,
          borderRadius: 8,
          padding: "0.7rem 1rem",
          background: "var(--teal-600)",
          color: "white",
          fontWeight: 700,
        }}
      >
        {busy ? "Saving…" : "Save merchant policy"}
      </button>
      {notice && (
        <p role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
    </form>
  );
}
