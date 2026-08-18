# Issue tracker: Local Markdown

Issues and specs (also called PRDs) for this repository live in this file.

## Conventions

- Keep all issues in this file.
- Give each issue a stable, sequential identifier: `ISSUE-001`, `ISSUE-002`, and so on.
- Write each issue under a second-level heading: `## ISSUE-NNN: Title`.
- Record the issue type as a `Type:` line.
- Record triage state as a `Status:` line using a role from `triage-labels.md`.
- Append discussion under a third-level `### Comments` heading within the issue.
- Never reuse or renumber an identifier.

## When a skill says “publish to the issue tracker”

Append the new issue or PRD to this file, assigning the next unused identifier.

## When a skill says “fetch the relevant ticket”

Read the section whose heading contains the referenced identifier. If the user supplies a title instead, locate the matching issue heading.

## ISSUE-001: Phase 1 credential and architecture-source decisions

Type: Architecture decision
Status: ready-for-agent

### Comments

- Resolved on 2026-08-17. Local deployment setup and integration fixtures create two database users before `dbsetup` runs.
- `dbsetup` uses the schema-owner credential. Fiber uses the separate SELECT-only credential. Application commands do not create database users.
- Local setup removes `PUBLIC` object-creation and temporary-table privileges. One real PostgreSQL integration test must prove that the Fiber credential can read but cannot write or create database objects.
- The ARCH-013 link to ADR 0001 now points to the existing sibling file.

## ISSUE-002: Phase 2 catalog and acceptance fixture designation

Type: Product decision
Status: ready-for-agent

### Comments

- Resolved with the project owner on 2026-08-18. Food Object IDs are the fixed opaque integers `1` through `38`. Application code must not infer meaning or contiguity from them.
- Food Family ID `1` contains only Pizza Margherita and Pizza Capricciosa. Every other Food Object has no Food Family.
- Known image keys are `pizza-margherita`, `chicken-breast`, `milk`, and `gyoza`; all other image keys are `NULL`. Unknown and failed image behavior uses isolated frontend integration fixtures rather than invalid production catalog data.
- Macro Profiles are plausible test-designed source values. Production nutrition is not shaped to manufacture artificial ties or rounding boundaries; later calculation phases own isolated fixtures for those cases.
- Macro Profile values below are grams per Nutrition Basis: `100 g` for solids and `100 ml` for liquids.

| ID | English | Polish | State | Serving | Family | Image key | Protein | Carbohydrate | Fat |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| 1 | Pizza Margherita | Pizza margherita | `solid` | 350 g | 1 | `pizza-margherita` | 10 | 30 | 10 |
| 2 | Pizza Capricciosa | Pizza capricciosa | `solid` | 350 g | 1 | — | 11 | 28 | 11 |
| 3 | Lasagna | Lazania | `solid` | 350 g | — | — | 9 | 18 | 8 |
| 4 | Pierogi | Pierogi | `solid` | 250 g | — | — | 6 | 32 | 5 |
| 5 | Chicken breast | Pierś z kurczaka | `solid` | — | — | `chicken-breast` | 31 | 0 | 3.6 |
| 6 | Pork chop | Kotlet wieprzowy | `solid` | — | — | — | 27 | 0 | 14 |
| 7 | Beef steak | Stek wołowy | `solid` | — | — | — | 26 | 0 | 15 |
| 8 | Mixed berries | Owoce jagodowe | `solid` | — | — | — | 1 | 12 | 0.5 |
| 9 | Apple juice | Sok jabłkowy | `liquid` | — | — | — | 0.1 | 11 | 0.1 |
| 10 | Milk | Mleko | `liquid` | — | — | `milk` | 3.4 | 4.8 | 2 |
| 11 | Skyr yogurt | Jogurt skyr | `solid` | 150 g | — | — | 11 | 4 | 0.2 |
| 12 | Greek yogurt | Jogurt grecki | `solid` | 170 g | — | — | 9 | 4 | 5 |
| 13 | Gyoza | Pierożki gyoza | `solid` | 200 g | — | `gyoza` | 8 | 24 | 8 |
| 14 | Oat milk | Napój owsiany | `liquid` | — | — | — | 1 | 7 | 1.5 |
| 15 | Kebab | Kebab | `solid` | 350 g | — | — | 15 | 18 | 12 |
| 16 | Gyros | Gyros | `solid` | 300 g | — | — | 18 | 10 | 14 |
| 17 | Polish chicken soup | Rosół | `liquid` | 300 ml | — | — | 2 | 1 | 1 |
| 18 | Butter | Masło | `solid` | — | — | — | 0.5 | 0.5 | 82 |
| 19 | Olive oil | Oliwa z oliwek | `liquid` | — | — | — | 0 | 0 | 91.3 |
| 20 | Protein shake | Shake białkowy | `liquid` | 300 ml | — | — | 8 | 4 | 1 |
| 21 | Beef cheeseburger | Cheeseburger wołowy | `solid` | 220 g | — | — | 13 | 24 | 13 |
| 22 | Fried chicken wings | Smażone skrzydełka z kurczaka | `solid` | 180 g | — | — | 22 | 8 | 20 |
| 23 | Turkey breast | Pierś z indyka | `solid` | — | — | — | 29 | 0 | 2 |
| 24 | Pickled cucumbers | Ogórki kiszone | `solid` | — | — | — | 0.5 | 2 | 0.2 |
| 25 | Tomatoes | Pomidory | `solid` | — | — | — | 0.9 | 3.9 | 0.2 |
| 26 | Pancakes | Naleśniki | `solid` | 150 g | — | — | 6 | 28 | 7 |
| 27 | Omelette | Omlet | `solid` | 180 g | — | — | 11 | 1 | 12 |
| 28 | Oatmeal | Owsianka | `solid` | 250 g | — | — | 2.5 | 12 | 1.5 |
| 29 | Paella | Paella | `solid` | 350 g | — | — | 8 | 20 | 5 |
| 30 | Pho | Zupa pho | `liquid` | 400 ml | — | — | 3 | 8 | 1.5 |
| 31 | Beetroot borscht | Barszcz czerwony | `liquid` | 300 ml | — | — | 1 | 7 | 0.5 |
| 32 | Coleslaw | Surówka coleslaw | `solid` | 100 g | — | — | 1 | 10 | 8 |
| 33 | Mondongo | Zupa mondongo | `liquid` | 350 ml | — | — | 7 | 8 | 4 |
| 34 | Bandeja paisa | Bandeja paisa | `solid` | 500 g | — | — | 12 | 20 | 15 |
| 35 | Pastel de nata | Pastel de nata | `solid` | 60 g | — | — | 5 | 35 | 14 |
| 36 | Cheesecake | Sernik | `solid` | 120 g | — | — | 7 | 25 | 18 |
| 37 | Orange juice | Sok pomarańczowy | `liquid` | — | — | — | 0.7 | 10 | 0.2 |
| 38 | Goulash | Gulasz | `solid` | 350 g | — | — | 15 | 6 | 10 |

- Designated acceptance inputs are Pizza Margherita at one Serving (`350 g`), Chicken breast at `100 g`, and Milk at `100 ml`. Their eligible-candidate counts are `36`, `37`, and `37`.
- Derived rankings, result IDs, Nutritional Similarities, Matched Quantities, numeric tolerances, and projection cases are implementation-test data owned by the later behavior phases, not this product decision.

## ISSUE-003: Phase 2 zero-result catalog compatibility

Type: Architecture decision
Status: wontfix

### Comments

- Resolved on 2026-08-18. Zero eligible Substitutes are unreachable in the supported POC deployment because the deterministic catalog satisfies REQ-071 and the runtime credential cannot change catalog data.
- REQ-044 remains active as defensive frontend behavior for a successful empty response. The project will not add a separate PostgreSQL fixture, a production eligibility rule, or a catalog-coverage exception for this unreachable acceptance scenario.
