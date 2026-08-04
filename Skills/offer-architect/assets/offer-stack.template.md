# Offer Stack Template

The stack is the reveal: many named bundles, each with a dollar value, summed to a large total — then a much lower price. Copy this file and replace every `<...>`. Feed the same rows into `../scripts/offer_stack_builder.py` to compute the total and ratio.

---

## `<OFFER NAME>`
*For `<avatar>` who want `<dream outcome>`.*

| # | Named Bundle | What it solves (problem → solution) | Delivery vehicle(s) | Value |
|---|---|---|---|---|
| 1 | `<Named Bundle A>` | `<problem → How-to solution>` | `<1:1 / DFY / recorded / …>` | `$<value>` |
| 2 | `<Named Bundle B>` | `<...>` | `<...>` | `$<value>` |
| 3 | `<Named Bundle C>` | `<...>` | `<...>` | `$<value>` |
| 4 | `<Named Bundle D>` | `<...>` | `<...>` | `$<value>` |

### Bonuses (value must eclipse the core)
| Bonus | Why it matters (next logical problem) | Value |
|---|---|---|
| `<Bonus 1>` | `<...>` | `$<value>` |
| `<Bonus 2>` | `<...>` | `$<value>` |

### The reveal
- **Total value:** `$<sum of all rows above>`
- **Guarantee:** `<named guarantee with teeth>`
- **Scarcity / Urgency:** `<cap + deadline wording>`
- **Today's price:** `$<premium price>`
- **You save:** `$<total − price>`  ·  **`<total / price>x value`**

---

### Compute it
```
python ../scripts/offer_stack_builder.py --price <price> \
    --item "<Named Bundle A>:<value>" \
    --item "<Named Bundle B>:<value>" \
    --item "<Bonus 1>:<value>"
```
Book reference: bundles summing to **$4,351** offered for **$599** → 7.26x value.

### Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
