# Phase 25 wrapper-export source inventory — 2026-09-29

This is a **pre-checkpoint source inventory**, not Plan 25-00 Task 2 completion or an owner release. Source baseline: `a8b3ea6` on `step0-evidence-integrity`. The command below scans non-test, non-generated Convex source for exported uses of the six tenant/owner wrappers. It does not prove that all public functions use a wrapper, and it does not inspect HTTP routes or conditional in-handler owner checks.

```text
rg -n 'export const [A-Za-z0-9_]+ = (tenantQuery|tenantMutation|tenantAction|ownerQuery|ownerMutation|ownerAction)\(' packages/backend/convex --glob '!**/*.test.ts' --glob '!**/_generated/**'
```

**322 direct wrapper exports across 84 files:** ownerAction 1, ownerMutation 23, ownerQuery 17, tenantAction 50, tenantMutation 109, tenantQuery 122. Of these, **41** use an owner wrapper. This corrects the earlier 40 owner-query/mutation-only count by including the one `ownerAction` export.

| Convex module | Direct exported wrapper functions |
|---|---|
| `agenda.ts` | `current` (tenantQuery); `dismiss` (tenantMutation) |
| `agentSteps.ts` | `latestTurn` (tenantQuery) |
| `approvals.ts` | `summary` (tenantQuery); `listAwaiting` (tenantQuery); `listScheduled` (tenantQuery); `listInFlight` (tenantQuery); `runningWork` (tenantQuery); `listCleared` (tenantQuery); `listDecisions` (tenantQuery); `answerDecision` (tenantMutation); `blockedSummary` (tenantQuery) |
| `betaJourney.ts` | `recordBrowserSession` (tenantMutation); `recordFirstOfferShown` (tenantMutation); `recordPrerequisiteRecovered` (tenantMutation); `history` (tenantQuery); `metrics` (tenantQuery) |
| `billing.ts` | `startCheckout` (tenantAction); `portalLink` (tenantAction); `billingStatus` (tenantQuery); `unappliedFunds` (tenantQuery); `invoices` (tenantQuery) |
| `billingRollup.ts` | `raiseAdjustment` (ownerMutation) |
| `blueprint.ts` | `confirmBlueprint` (tenantMutation); `discardDraft` (tenantMutation); `blueprintState` (tenantQuery); `buildBlueprintDraft` (tenantAction); `blueprintPulse` (tenantQuery) |
| `briefings.ts` | `byThread` (tenantQuery); `latestForTenant` (tenantQuery) |
| `calendarEvents.ts` | `forCard` (tenantQuery) |
| `calendarViews.ts` | `byThread` (tenantQuery) |
| `cash.ts` | `activity` (tenantQuery); `inputs` (tenantQuery); `unitEconomics` (tenantQuery); `shape` (tenantQuery); `solvency` (tenantQuery); `saveInput` (tenantMutation) |
| `cockpit.ts` | `startWorkflowPack` (tenantAction); `startVerticalPack` (tenantAction); `sendCockpitMessage` (tenantAction); `resolveRecipients` (tenantAction); `listThreadMessages` (tenantQuery); `listThreads` (tenantQuery); `clearChatHistory` (tenantMutation); `startFirstSend` (tenantAction); `executePlan` (tenantMutation); `cancelScheduledPlan` (tenantMutation); `discardPlan` (tenantMutation); `moveScheduledPlan` (tenantMutation); `reschedulePlan` (tenantMutation) |
| `connectorConnections.ts` | `connections` (tenantQuery); `startConnect` (tenantAction); `disconnectProvider` (tenantAction) |
| `connectorCredentials.ts` | `connectorStatuses` (tenantQuery) |
| `connectorOAuth.ts` | `mintConnectState` (tenantMutation); `pendingConnectStates` (tenantQuery) |
| `contacts.ts` | `upsertContact` (tenantMutation); `recordMarketingLead` (tenantMutation); `assertConsent` (tenantMutation); `consentRecord` (tenantQuery); `markSuppressed` (tenantMutation); `unsuppress` (tenantMutation); `createFollowUp` (tenantMutation); `setFollowUpStatus` (tenantMutation); `pipelineTiles` (tenantQuery); `listContacts` (tenantQuery); `listUnassignedFollowUps` (tenantQuery); `matchExisting` (tenantQuery); `importContacts` (tenantMutation) |
| `content.ts` | `listArtifacts` (tenantQuery); `summary` (tenantQuery); `artifactById` (tenantQuery) |
| `contentAudit.ts` | `recordPromotion` (tenantMutation) |
| `deadLetters.ts` | `newCount` (tenantQuery); `listNew` (tenantQuery); `listAll` (ownerQuery); `markResolved` (tenantMutation) |
| `demo.ts` | `addItem` (tenantMutation); `listItems` (tenantQuery) |
| `evaluations.ts` | `recordScorecardAnswer` (tenantMutation); `actOnGap` (tenantMutation); `byThread` (tenantQuery) |
| `feedback.ts` | `submitFeedback` (tenantMutation); `undoFeedback` (tenantMutation); `myFeedback` (tenantQuery) |
| `finance.ts` | `coverage` (tenantQuery); `summary` (tenantQuery); `spendSeries` (tenantQuery); `mediaLedger` (tenantQuery); `globalRails` (ownerQuery); `controls` (ownerQuery); `setMasterKillSwitch` (ownerMutation); `setMediaKillSwitch` (ownerMutation); `setPerRequestBudget` (ownerMutation) |
| `funnels.ts` | `downloadableArtifacts` (tenantQuery); `create` (tenantMutation); `list` (tenantQuery); `deactivate` (tenantMutation) |
| `gmailAuth.ts` | `gmailStatus` (tenantQuery); `gmailConnectUrl` (tenantQuery); `disconnectGoogle` (tenantAction) |
| `goals.ts` | `listGoals` (tenantQuery); `addGoal` (tenantMutation); `setGoalStatus` (tenantMutation) |
| `home.ts` | `summary` (tenantQuery); `health` (tenantQuery) |
| `hubspot.ts` | `hubspotRead` (tenantAction) |
| `hubspotAuth.ts` | `hubspotConnectUrl` (tenantAction); `disconnectHubSpot` (tenantAction) |
| `intake.ts` | `attachToThread` (tenantAction); `dictateToThread` (tenantAction) |
| `intakeDb.ts` | `generateUploadUrl` (tenantMutation); `byThread` (tenantQuery) |
| `invites.ts` | `pending` (ownerQuery); `approve` (ownerMutation) |
| `knowledgeSearch.ts` | `listByThread` (tenantQuery); `search` (tenantAction) |
| `media.ts` | `byPlan` (tenantQuery); `assetUrls` (tenantQuery); `reel` (tenantQuery); `jobEstimate` (tenantQuery); `imageEstimate` (tenantQuery); `generateReel` (tenantMutation); `generateImage` (tenantMutation); `regenerateBlock` (tenantMutation); `retryRender` (tenantMutation); `editBlockPrompt` (tenantMutation); `editBlockNarration` (tenantMutation); `setSceneAsset` (tenantMutation); `setSceneVisual` (tenantMutation); `reorderBlocks` (tenantMutation); `deleteBlock` (tenantMutation); `editBrief` (tenantMutation); `switchDeck` (tenantMutation); `confirmClaim` (tenantMutation); `sceneCitations` (tenantQuery) |
| `microsoftAuth.ts` | `microsoftStatus` (tenantQuery); `microsoftConnectUrl` (tenantQuery); `disconnectMicrosoft` (tenantAction) |
| `notifications.ts` | `list` (tenantQuery); `markRead` (tenantMutation) |
| `onboarding.ts` | `status` (tenantQuery); `getProfile` (tenantQuery); `extractProfile` (tenantAction); `converse` (tenantAction); `firstSendOffer` (tenantQuery); `commitProfile` (tenantMutation); `updateProfile` (tenantMutation) |
| `ops.ts` | `envCheck` (ownerQuery) |
| `opsSignals.ts` | `evalSignals` (tenantQuery); `revenueSignals` (tenantQuery) |
| `optimizerConfig.ts` | `getOptimizerStatus` (ownerQuery); `setOptimizerEnabled` (ownerMutation) |
| `owner.ts` | `viewer` (tenantQuery) |
| `paypalAuth.ts` | `beginConnect` (tenantAction); `disconnect` (tenantAction) |
| `paypalConnector.ts` | `readEntity` (tenantAction); `receiptsSummary` (tenantAction); `balanceOnHand` (tenantAction) |
| `pinnedWorkflows.ts` | `pinWorkflow` (tenantMutation); `unpinWorkflow` (tenantMutation); `listPins` (tenantQuery); `checkReadiness` (tenantQuery); `runAgain` (tenantAction) |
| `plans.ts` | `setPlanSendTime` (tenantMutation); `setPlanMailProvider` (tenantMutation); `attachmentUrls` (tenantQuery); `byThread` (tenantQuery); `byId` (tenantQuery); `reportForPlan` (tenantQuery) |
| `proposals.ts` | `acceptProposal` (tenantMutation); `discardProposal` (tenantMutation); `listPending` (tenantQuery) |
| `providerGates.ts` | `availableProviders` (tenantQuery); `revenueDiscovery` (tenantQuery); `inspectGate` (ownerQuery); `sealGate` (ownerMutation) |
| `quickbooks.ts` | `readEntity` (tenantAction); `receivablesSummary` (tenantAction); `cashOnHand` (tenantAction) |
| `quickbooksAuth.ts` | `beginConnect` (tenantAction); `disconnect` (tenantAction) |
| `reportPack.ts` | `generateBoardPack` (tenantAction) |
| `reportsBusiness.ts` | `business` (tenantQuery); `operations` (tenantQuery); `sentMail` (tenantQuery) |
| `reportsGovernance.ts` | `auditPage` (tenantQuery); `wormExport` (ownerQuery); `activeSkills` (ownerQuery) |
| `requests.ts` | `generateUploadUrl` (tenantMutation); `submit` (tenantMutation); `list` (tenantQuery); `submitDecision` (tenantMutation); `get` (tenantQuery); `reviewGate` (tenantQuery) |
| `revenueCrm.ts` | `attentionList` (tenantQuery); `contactPulse` (tenantQuery) |
| `revenueFinance.ts` | `businessFinance` (tenantAction) |
| `savedPrompts.ts` | `save` (tenantMutation); `list` (tenantQuery); `remove` (tenantMutation) |
| `skills.ts` | `activateCandidate` (ownerMutation); `candidatesForReview` (ownerQuery); `webRecipeCandidatesForReview` (ownerQuery); `activateWebRecipeCandidate` (ownerMutation); `rollbackWebRecipe` (ownerMutation); `beginWebRecipeBrowserQualification` (ownerMutation); `advanceWebRecipeBrowserQualification` (ownerMutation); `finalizeWebRecipeBrowserQualification` (ownerMutation); `deactivatePack` (ownerMutation); `publishUserCandidate` (tenantMutation); `publishPackCustomization` (tenantMutation); `myUserSkills` (tenantQuery); `tenantCandidatesForReview` (ownerQuery); `activateTenantCandidate` (ownerMutation); `activateAgentCandidate` (ownerMutation); `rollbackTenantSkill` (ownerMutation) |
| `stripeAuth.ts` | `beginConnect` (tenantAction); `disconnect` (tenantAction) |
| `stripeConnector.ts` | `readEntity` (tenantAction); `receiptsSummary` (tenantAction); `balanceOnHand` (tenantAction); `openInvoices` (tenantAction) |
| `tenantCatalogue.ts` | `createProduct` (tenantMutation); `editProduct` (tenantMutation); `adjustStock` (tenantMutation); `configureStockPolicy` (tenantMutation); `reserveProduct` (tenantMutation); `releaseReservation` (tenantMutation); `expireReservation` (tenantMutation); `listProducts` (tenantQuery) |
| `tenantDelete.ts` | `deleteTenantData` (tenantAction) |
| `tenantExport.ts` | `exportTenantData` (tenantQuery) |
| `tenantOrders.ts` | `configurePolicy` (tenantMutation); `mapProduct` (tenantMutation); `createCart` (tenantMutation); `updateCart` (tenantMutation); `placeOrder` (tenantMutation); `reconcileExpiredProduct` (tenantMutation); `expireOrder` (tenantMutation); `cancelOrder` (tenantMutation); `getOrder` (tenantQuery) |
| `tenantProfile.ts` | `get` (tenantQuery); `saveFacts` (tenantMutation) |
| `vault.ts` | `vaultIngestText` (tenantMutation); `vaultUpload` (tenantMutation); `vaultUploadFolderFile` (tenantAction); `deleteVaultDoc` (tenantMutation); `setDocIdentity` (tenantMutation); `listVaultDocs` (tenantQuery); `vaultDocSheets` (tenantQuery); `vaultDocText` (tenantQuery); `vaultDoc` (tenantQuery); `vaultStats` (tenantQuery); `vaultDownloadUrl` (tenantQuery); `docEntities` (tenantQuery); `vaultSearch` (tenantAction); `promoteToReference` (tenantMutation) |
| `vaultDigest.ts` | `folderDigestState` (tenantQuery); `rebuildDigest` (tenantMutation) |
| `vaultDrive.ts` | `listDriveFolders` (tenantAction); `findInDrive` (tenantAction); `importDriveFolder` (tenantAction) |
| `vaultFolders.ts` | `createFolder` (tenantMutation); `createOrganizationalFolder` (tenantMutation); `moveDocuments` (tenantMutation); `reserveFolder` (tenantMutation); `cancelFolder` (tenantMutation); `folderEstimate` (tenantQuery); `listFolders` (tenantQuery); `getFolder` (tenantQuery) |
| `vaultGround.ts` | `vaultGround` (tenantAction) |
| `vaultSources.ts` | `byThread` (tenantQuery) |
| `vaultSweep.ts` | `retryExtraction` (tenantMutation) |
| `verticalArtifactEdit.ts` | `save` (tenantAction) |
| `verticalData.ts` | `previewDataset` (ownerAction) |
| `verticalEvalEvidence.ts` | `inspectCase` (ownerQuery); `reviewCase` (ownerMutation); `abandonCase` (ownerMutation); `finalize` (ownerMutation); `inspectRun` (ownerQuery) |
| `verticalPackTelemetry.ts` | `summary` (tenantQuery) |
| `verticalPacks.ts` | `discover` (tenantQuery); `reviewTarget` (tenantQuery); `recordReview` (tenantMutation); `recordShown` (tenantMutation); `recordAccepted` (tenantMutation); `workloadSources` (tenantQuery); `configure` (tenantMutation); `setDisabled` (tenantMutation); `rollback` (ownerMutation) |
| `voice.ts` | `startSession` (tenantMutation); `endSessionClean` (tenantMutation); `abortSession` (tenantMutation); `recordUsage` (tenantMutation) |
| `voiceDoc.ts` | `searchDocument` (tenantAction); `reviewSession` (tenantAction); `docContext` (tenantQuery); `pickableDocs` (tenantQuery) |
| `voiceToken.ts` | `mintClientSecret` (tenantAction) |
| `webProjects.ts` | `createDraft` (tenantMutation); `saveDraft` (tenantMutation); `approveVersion` (tenantMutation); `publishVersion` (tenantMutation); `updateVersion` (tenantMutation); `unpublish` (tenantMutation); `rollback` (tenantMutation); `getProject` (tenantQuery); `listProjects` (tenantQuery); `getVersion` (tenantQuery); `listVersions` (tenantQuery) |
| `webRecipes.ts` | `listAvailable` (tenantQuery); `createProjectFromRecipe` (tenantMutation); `qualifyStorefront` (ownerMutation); `previewWebRecipeCandidate` (ownerMutation); `getStorefrontQualification` (ownerQuery) |
| `workflowPackDiscovery.ts` | `listPacks` (tenantQuery); `listPackPriorVersions` (ownerQuery); `listPackCandidates` (ownerQuery) |
| `workflowPackEventLog.ts` | `forTenant` (tenantQuery) |
| `workflowPackOutcomes.ts` | `forTenant` (tenantQuery) |

The scan's exact regex is a declared limit: aliases, re-exports, raw builders, exported function declarations, dynamic registration, and HTTP entry points require separate inventory/review. The three known raw public registrations in `invites.ts` (`requestAccess`, `authProviders`, `preflight`) are **not** included here. Plan 25-18's public/owner/HTTP authorization coverage packet must account for those and any further exceptions before deploy. No source or deployment gate is released by this file.
