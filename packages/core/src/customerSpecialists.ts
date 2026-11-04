/** Customer-authored configuration is data; executable capability grants stay in the runner. */
export type CustomerSpecialistDefinition = {
  name: string;
  objective: string;
  audience: string;
  instructions: string;
  knowledgeDocumentIds: string[];
};

export const CUSTOMER_SPECIALIST_LIMIT = 50;
export const CUSTOMER_SPECIALIST_FIELD_LIMITS = {
  name: 80,
  objective: 1000,
  audience: 1000,
  instructions: 8000,
  knowledgeDocumentIds: 10,
} as const;

export function validateCustomerSpecialist(
  input: CustomerSpecialistDefinition,
): CustomerSpecialistDefinition {
  const result = {
    name: input.name,
    objective: input.objective,
    audience: input.audience,
    instructions: input.instructions,
    knowledgeDocumentIds: [...new Set(input.knowledgeDocumentIds)],
  };
  for (const field of ["name", "objective", "audience", "instructions"] as const) {
    const value = input[field].trim();
    if (!value || value.length > CUSTOMER_SPECIALIST_FIELD_LIMITS[field]) {
      throw new Error(`INVALID_SPECIALIST_${field.toUpperCase()}`);
    }
    result[field] = value;
  }
  if (
    input.knowledgeDocumentIds.length > CUSTOMER_SPECIALIST_FIELD_LIMITS.knowledgeDocumentIds ||
    input.knowledgeDocumentIds.some((id) => !id.trim())
  ) {
    throw new Error("INVALID_SPECIALIST_KNOWLEDGE");
  }
  return result;
}
