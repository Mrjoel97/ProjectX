# Phase 25 parsed-schema inventory — 2026-09-29

This is a **pre-checkpoint technical snapshot**, not Plan 25-00 Task 2 completion or an owner release. Source baseline: `3a3f2fb` on `step0-evidence-integrity`; the inventory test was added in this worktree after that commit. It imports the actual `schema.tables` object under the backend Vitest runtime, including the `authTables` spread. It does not query a deployed backend.

Command: set `PIKAR_SCHEMA_INVENTORY=1`, then run `pnpm --filter @pikar/backend test phase25Inventory`. The test prints machine-readable `PHASE25_SCHEMA_INVENTORY` JSON with the table names and every declared index descriptor/field list. It passed 1/1. Runtime counts: **82 tables**, **211 ordinary indexes**, **0 search indexes**, **0 vector indexes**. All descriptors are unique within their table. The earlier 76-table/189-index anchored source scan is not a runtime inventory and must not be used as the Phase 25 baseline.

| Parsed table | Declared ordinary index descriptors and fields |
|---|---|
| `agenda` | `by_tenant` (tenantId); `by_tenant_key` (tenantId, key) |
| `agentSteps` | `by_turn` (tenantId, turnId); `by_turn_step` (tenantId, turnId, stepKey); `by_tenant` (tenantId); `by_tenant_tool_startedAt` (tenantId, tool, startedAt) |
| `attachments` | `by_tenant` (tenantId); `by_request` (requestId) |
| `audit` | `by_tenant_ts` (tenantId, ts); `by_tenant_event_ts` (tenantId, eventType, ts); `by_correlation` (correlationId); `by_tenant_correlation_vertical_event_preview_artifact` (tenantId, correlationId, verticalEvent, verticalPreview, verticalArtifactId); `by_tenant_vertical_artifact_event_preview` (tenantId, verticalArtifactId, verticalEvent, verticalPreview); `by_ts` (ts); `by_export_version` (exportVersion) |
| `auditExportQueue` | `by_audit` (auditId) |
| `authAccounts` | `userIdAndProvider` (userId, provider); `providerAndAccountId` (provider, providerAccountId) |
| `authRateLimits` | `identifier` (identifier) |
| `authRefreshTokens` | `sessionId` (sessionId); `sessionIdAndParentRefreshTokenId` (sessionId, parentRefreshTokenId) |
| `authSessions` | `userId` (userId) |
| `authVerificationCodes` | `accountId` (accountId); `code` (code) |
| `authVerifiers` | `signature` (signature) |
| `betaInvites` | `by_email` (email); `by_code` (code) |
| `betaJourneyEvents` | `by_tenant` (tenantId); `by_tenant_occurredAt` (tenantId, occurredAt); `by_tenant_key` (tenantId, idempotencyKey) |
| `betaWaitlist` | `by_email` (email); `by_status_requested` (status, requestedAt) |
| `billingCoverage` | `by_tenant` (tenantId) |
| `billingCustomers` | `by_tenant` (tenantId); `by_customer` (stripeCustomerId) |
| `billingEvents` | `by_tenant_createdAt` (tenantId, createdAt); `by_correlation` (correlationId) |
| `billingPeriods` | `by_tenant` (tenantId, periodKey); `by_status_dueAt` (status, dueAt) |
| `billingStripeEvents` | `by_event` (eventId); `by_object_type` (objectId, eventType) |
| `billingUnapplied` | `by_tenant` (tenantId); `by_tenant_object_currency` (tenantId, stripeObjectId, currency) |
| `briefings` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId); `by_tenant_createdAt` (tenantId, createdAt) |
| `calendarEvents` | `by_tenant_status` (tenantId, status); `by_tenant` (tenantId); `by_tenant_provider_external` (tenantId, provider, externalEventId) |
| `calendarFixtures` | `by_tenant` (tenantId) |
| `calendarViews` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId) |
| `connectorConnections` | `by_tenant` (tenantId); `by_tenant_provider_environment` (tenantId, provider, environment) |
| `connectorOAuthStates` | `by_tenant` (tenantId); `by_state` (stateHash) |
| `contactProviderRefs` | `by_tenant` (tenantId); `by_tenant_contact` (tenantId, contactId); `by_tenant_provider_external` (tenantId, provider, externalId) |
| `contacts` | `by_tenant` (tenantId); `by_tenant_email` (tenantId, email); `by_tenant_createdAt` (tenantId, createdAt) |
| `deadLetters` | `by_tenant` (tenantId); `by_status` (status); `by_tenant_status` (tenantId, status) |
| `demoItems` | `by_tenant` (tenantId) |
| `evaluations` | `by_tenant` (tenantId); `by_tenant_thread` (tenantId, threadId) |
| `exportCursors` | `by_name` (name) |
| `feedback` | `by_tenant` (tenantId); `by_tenant_request` (tenantId, requestId); `by_tenant_createdAt` (tenantId, createdAt); `by_skill` (skillName, skillVersion) |
| `financeInputs` | `by_tenant` (tenantId); `by_tenant_field` (tenantId, field) |
| `followUps` | `by_tenant` (tenantId); `by_tenant_status_dueAt` (tenantId, status, dueAt); `by_tenant_contact` (tenantId, contactId) |
| `funnels` | `by_tenant` (tenantId, createdAt); `by_token_hash` (tokenHash) |
| `gmailTokens` | `by_tenant` (tenantId) |
| `goals` | `by_tenant` (tenantId); `by_tenant_status` (tenantId, status) |
| `goldenEvalAttempts` | `by_attempt_id` (attemptId) |
| `graphEdges` | `by_tenant` (tenantId); `by_tenant_fromNode` (tenantId, fromNodeId); `by_tenant_toNode` (tenantId, toNodeId); `by_tenant_source` (tenantId, sourceDocId) |
| `graphNodes` | `by_tenant` (tenantId); `by_tenant_normalized` (tenantId, normalizedName); `by_tenant_degree` (tenantId, degree) |
| `guardrailConfig` | — |
| `inboxFixtures` | `by_tenant` (tenantId) |
| `intakeArtifacts` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId) |
| `knowledgeSearches` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId); `by_tenant_createdAt` (tenantId, createdAt) |
| `mediaJobs` | `by_plan` (tenantId, planId); `by_tenant` (tenantId); `by_batch` (tenantId, batchId); `by_tenant_createdAt` (tenantId, createdAt) |
| `microsoftCalendarTokens` | `by_tenant` (tenantId) |
| `notifications` | `by_tenant` (tenantId); `by_tenant_read` (tenantId, read); `by_tenant_kind_read` (tenantId, kind, read) |
| `optimizerConfig` | — |
| `pendingTimeouts` | `by_workflow` (workflowId); `by_correlation` (correlationId) |
| `plans` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId); `by_tenant_status_createdAt` (tenantId, status, createdAt); `by_calendar_run` (calendarRunId); `by_media_run` (mediaRunId); `by_render_run` (renderRunId); `by_parent` (tenantId, parentPlanId) |
| `proposals` | `by_tenant_status` (tenantId, status); `by_tenant` (tenantId); `by_tenant_source` (tenantId, sourceKind, sourceRef) |
| `providerGates` | `by_provider_environment` (provider, environment) |
| `requests` | `by_tenant` (tenantId); `by_tenant_status` (tenantId, status); `by_tenant_status_createdAt` (tenantId, status, createdAt); `by_correlation` (correlationId); `by_tenant_safeTextHash` (tenantId, safeTextHash); `by_plan` (planId) |
| `researchControls` | `by_tenant` (tenantId); `by_tenant_request` (tenantId, requestId) |
| `savedPrompts` | `by_tenant` (tenantId); `by_tenant_createdAt` (tenantId, createdAt); `by_tenant_textHash` (tenantId, textHash); `by_tenant_template` (tenantId, templateId) |
| `skills` | `by_name_status` (name, status); `by_name_version` (name, version) |
| `spendCoverage` | `by_tenant` (tenantId) |
| `spendEvents` | `by_tenant_createdAt` (tenantId, createdAt); `by_tenant` (tenantId); `by_tenant_rail_createdAt` (tenantId, rail, createdAt); `by_correlation` (correlationId); `by_eval_budget` (evalBudgetId); `by_probe_thread` (tenantId, evalAuthoringProbe.threadId) |
| `suppressions` | `by_tenant` (tenantId); `by_tenant_address` (tenantId, address) |
| `telemetry` | `by_correlation` (correlationId); `by_tenant` (tenantId); `by_tenant_created` (tenantId, createdAt) |
| `tenantCarts` | `by_tenant` (tenantId); `by_tenant_project` (tenantId, projectId); `by_tenant_expiry` (tenantId, expiresAt) |
| `tenantCommerceMappings` | `by_tenant` (tenantId); `by_tenant_project_item` (tenantId, projectId, presentationItemId) |
| `tenantCommercePolicies` | `by_tenant` (tenantId); `by_tenant_project_revision` (tenantId, projectId, revision) |
| `tenantOrderAttempts` | `by_tenant` (tenantId); `by_tenant_order` (tenantId, orderId); `by_tenant_cart_revision` (tenantId, cartId, cartRevision); `by_tenant_cart_retry` (tenantId, cartId, retryKeyHash) |
| `tenantOrders` | `by_tenant` (tenantId); `by_tenant_cart` (tenantId, cartId) |
| `tenantProducts` | `by_tenant` (tenantId); `by_tenant_sku_variant` (tenantId, sku, variant) |
| `tenantProfiles` | `by_tenant` (tenantId) |
| `tenantReservations` | `by_tenant` (tenantId); `by_tenant_product` (tenantId, productId); `by_tenant_order` (tenantId, orderId); `by_tenant_product_status_expiry` (tenantId, productId, status, expiresAt); `by_tenant_status_expiry` (tenantId, status, expiresAt) |
| `tenantSkills` | `by_tenant` (tenantId); `by_tenant_name_status` (tenantId, name, status); `by_tenant_name_version` (tenantId, name, version); `by_tenant_createdAt` (tenantId, createdAt); `by_tenant_name_rollbackEligible` (tenantId, name, rollbackEligible); `by_status_createdAt` (status, createdAt); `by_tenant_source_turn` (tenantId, sourceThreadId, sourceTurnId); `by_tenant_template` (tenantId, templateId) |
| `tenantStock` | `by_tenant` (tenantId); `by_tenant_product` (tenantId, productId) |
| `users` | `email` (email); `phone` (phone) |
| `vaultDocuments` | `by_tenant` (tenantId); `by_tenant_contentHash` (tenantId, contentHash); `by_tenant_status` (tenantId, status); `by_tenant_kind` (tenantId, kind, createdAt); `by_tenant_folder` (tenantId, folderId); `by_tenant_driveFileId` (tenantId, driveFileId); `by_tenant_origin_createdAt` (tenantId, origin, createdAt); `by_kind` (kind) |
| `vaultFolders` | `by_tenant` (tenantId) |
| `vaultSheets` | `by_doc` (tenantId, docId); `by_tenant` (tenantId) |
| `vaultSources` | `by_tenant` (tenantId); `by_thread` (tenantId, threadId) |
| `voiceSessions` | `by_tenant` (tenantId); `by_tenant_status` (tenantId, status) |
| `webMetrics` | `by_tenant` (tenantId); `by_tenant_project_kind_window` (tenantId, projectId, kind, windowStartedAt) |
| `webProjects` | `by_tenant` (tenantId); `by_tenant_slug` (tenantId, slug); `by_tenant_host_slug` (tenantId, publicHost, slug); `by_host_slug` (publicHost, slug); `by_slug` (slug) |
| `webProjectVersions` | `by_tenant` (tenantId); `by_tenant_project_version` (tenantId, projectId, version); `by_tenant_project_hash` (tenantId, projectId, contentHash) |
| `webSubmissions` | `by_tenant` (tenantId); `by_tenant_expires_at` (tenantId, expiresAt); `by_expires_at` (expiresAt); `by_tenant_idempotency` (tenantId, projectId, formId, idempotencyKeyHash); `by_tenant_abuse_bucket` (tenantId, abuseBucketHash, abuseWindowExpiresAt) |
| `workflowPackEvents` | `by_tenant_createdAt` (tenantId, createdAt); `by_tenant_pack_createdAt` (tenantId, packId, createdAt); `by_tenant_run` (tenantId, runId); `by_tenant_plan` (tenantId, planId) |

This snapshot addresses only the parsed-schema portion of Task 2. Wrapper exports, Gmail callers, environment keys, key validators, onboarding/Approve paths, beta-receivable URLs, playbook watch map, foreign edits, and final SHA/drift reconciliation remain unverified here. No 25-00 summary or execution gate is released by this file.
