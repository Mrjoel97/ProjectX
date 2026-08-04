# Playbook 09 — Employees (hire lead-getters)

Lead Getter #2. Hire people to run the Core Four for you. Reference:
`../references/lead-getters.md` (#2). Adopt after referrals are working.

## Inputs
- Which Core Four activity you want the hire to run.
- Your payroll budget and your leads-per-customer ratio.
- The checklist for the task (you'll write it in training).

## Step 1 — Hire with the internal Core Four
You get employees the same way you get leads — run the Core Four to recruit:
- **Warm = Ask Your Network.**
- **Cold = Recruiting** (reach out to strangers who fit).
- **Content = Post Job Openings.**
- **Paid = Promote the Postings.**

## Step 2 — Train with the 3 Ds
1. **Document** — write the exact checklist for the task.
2. **Demonstrate** — do it in front of them.
3. **Duplicate** — they do it; you correct the *checklist*, not the person.
> *"If they get it wrong, YOU got the checklist wrong."*

## Step 3 — Measure returns (the diagnostic)
- **Total Payroll ÷ Total Engaged Leads = cost per engaged lead.**
- **× leads-per-customer = CAC.**
- **LTGP ÷ CAC = ratio** (want ≥ 3:1).
- If **CAC > 3x industry average**, ask: *"Do the leads have the problem AND the money?"*
  - **No** → it's an **advertising** problem (wrong leads / not enough).
  - **Yes, but not buying** → it's a **sales** problem, not a lead problem.

## Artifact
A **hiring + training plan:** which Core Four the role runs, the recruiting channel(s),
the task checklist (the "Document" step), and the returns math (cost/lead → CAC → ratio).

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.lead_getters_active.employees --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"09-employees","artifact":"hiring_training_plan","role_channel":"<core_four>"}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
