# Catalog source review

Scope: Source URLs in the 401 Ingredient and 320 Meal records at `data` revision `3b5d042881ba240b6e839682104add80294b2210`. The counts below refer to fields, not necessarily distinct records. This review covers data sources, not the origin or licence of each image. It records the publishers’ stated terms, not a legal opinion or proof that Obiad has a separate licence.

## Ingredient nutrition

| Source | Records | Reuse decision for a public app |
| --- | ---: | --- |
| [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide.html#licensing) | 369 | USDA publishes FDC data under CC0 and requests credit. No share-alike. |
| [Open Food Facts](https://world.openfoodfacts.org/terms-of-use#re-use) | 29 | [ODbL §§4.4–4.6](https://opendatacommons.org/licenses/odbl/1-0/) can require an offer of a derivative database or the complete changes when it or its output is used publicly. This does not automatically cover every independent record. For a private catalog, use independently sourced measurements. Eight of these 29 records also cite OFF for a portion conversion. |
| [Piątnica](https://piatnica.com.pl/en/product/smietana-18-1-kg-2-en/) | 1 | Sour cream (#38). Manufacturer’s nutrition declaration. No general reuse licence found in the [site policy](https://piatnica.com.pl/en/privacy-and-cookie-policy/). Record the figures from the matching package; do not copy the photo or product description. |
| [Carb Manager](https://www.carbmanager.com/food-detail/cc:401c454d76a5cf5faf3dd9745048b0ec/lemon-grass-citronella-raw) | 1 | Lemongrass (#44). The cited record identifies its source as NCC, not USDA. [Carb Manager’s terms](https://www.carbmanager.com/terms-of-service) do not grant a general downstream data licence; [NCC offers separate licences](https://www.ncc.umn.edu/food-and-nutrient-database/). Re-source or license the values. Check available carbohydrate, not just total carbohydrate. |
| [Medycyna Praktyczna](https://www.mp.pl/pacjent/dieta/zasady/375222,pietruszka-natka-i-korzen-wlasciwosci-jak-odroznic-od-pasternaku) | 1 | Parsley root (#71). The article credits a third-party PZWL table and reserves text and data mining rights. No commercial table licence found. Use independently sourced numbers or obtain permission. |

## Other measurements

These inputs are not necessarily displayed. A portion weight can still affect a Meal calculation if authoring used it to convert a recipe quantity to grams. Recalculate those quantities when a replacement measurement differs.

| Source | Recorded use | Reuse decision |
| --- | --- | --- |
| [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide.html#licensing) | 363 portion conversions and 15 densities | CC0 as above. |
| [USDA ARS household codebook](https://www.ars.usda.gov/ARSUserFiles/80400530/pdf/6566/hfcs65_hhold_cdbk.pdf) | 5 portion weights | Not FDC. Tables include a contractor credit. [USDA policy](https://www.usda.gov/about-usda/policies-and-links) says most, not all, USDA site information is public domain. Do not label the codebook CC0; corroborate the weights rather than copying the tables. |
| [FAO/INFOODS conversion guidelines (2012), p. 3](https://www.fao.org/fileadmin/templates/food_composition/documents/1nutrition/Conversion_Guidelines-V1.0.pdf#page=3) | 40 conversions | The PDF reserves reproduction rights; commercial reproduction may incur fees. The 40 entries use only two unit definitions (lb and oz). Derive them independently from [NIST Handbook 44, Appendix C](https://www.nist.gov/document/2026-nist-handbook-44-appendix-c). |
| [FAO/INFOODS density database (2012), p. 4](https://www.fao.org/4/ap815e/ap815e.pdf#page=4) | 20 densities and 1 conversion | Same PDF notice. [FAO’s publications policy](https://openknowledge.fao.org/3/i9461en/online/i9461en.html) excludes pre-June-2018 publications from its blanket CC policy. The [spreadsheet](https://www.fao.org/infoods/infoods/tables-and-databases/faoinfoods-databases/en/) has a separate [database policy](https://www.fao.org/contact-us/terms/db-terms-of-use/en) with attribution, purpose and third-party restrictions. Verify the source of each reused row and intended use, obtain permission, or measure independently. |
| [KalkulatorKalorii](https://kalkulatorkalorii.net/regulamin) | 3 weights: lemongrass, parsley root, celeriac | §3(4) limits use of posted content to personal use. Weigh defined portions or obtain permission. |
| [Norfolk Veg Box](https://norfolkvegbox.com/terms-conditions/) | 1 broccoli head weight | §3 restricts copying or storing site content outside personal, noncommercial use without permission. Its [listing](https://norfolkvegbox.com/shop/vegetables/broccoli/) gives approximate ranges, not an exact weight. Measure independently. |
| [DeLallo](https://www.delallo.com/lasagna-noodles/) | 1 dry lasagna sheet weight | Manufacturer label; no commercial content reuse licence found. Record a measurement or use the matching package declaration; do not reproduce the label image. |
| [Tasting Table / Static Media](https://www.static.com/terms) | 1 yield of zest per lemon | The terms limit site content to personal, noncommercial use without written permission. The [article](https://www.tastingtable.com/1244874/how-much-zest-per-lemon/) estimates tablespoons per fruit, not grams. Measure the yield independently. |
| [Engineering ToolBox](https://www.engineeringtoolbox.com/water-density-specific-weight-d_595.html) | 1 water density | Its [site notice](https://www.engineeringtoolbox.com/static/scripts/www.js) prohibits copying or redistributing content. Use the physical approximation of 1 g/mL from an independent source such as [USGS](https://www.usgs.gov/water-science-school/science/water-density), not the publisher’s table. |

## Meal recipes

The [exporter](../../data/src/obiad_data/meal_calculation.py#L80-L112) exports calculated macros, names and source URLs, not ingredient lists or recipe steps. Commercial permission, attribution, and share-alike are separate questions. A public recipe page is not necessarily a licence to copy its text or photos. [EU Database Directive, arts. 3 and 7](https://eur-lex.europa.eu/eli/dir/1996/9/2019-06-06/eng) also distinguishes rights in a collection from rights in individual facts and addresses repeated systematic extraction.

| Source | Meals | Reuse decision |
| --- | ---: | --- |
| [TheMealDB terms](https://www.themealdb.com/terms_of_use.php) | 240 | The terms allow copying and modifying official API responses, prohibit website scraping and API resale, preserve notices, and reserve third-party rights. The [API guide](https://www.themealdb.com/docs_api_guide.php) directs public production apps to a supporter key. Verify the account and intended use; no catalog share-alike identified. All 240 stored source URLs contain a non-test value in the API-key path segment. The exporter copies it verbatim. Use public recipe-page links instead; rotate the key if exposed. |
| [Kuchnia Domowa copyright notice](https://kuchnia-domowa.pl/prawa-autorskie) | 64 | Recipes have several origins. The notice requires separate written permission for photos and gives no general licence to republish recipe prose. Distinguish numerical outputs from copying recipes or publishing site images; confirm rights for systematic reuse. |
| [Wikibooks / Wikimedia terms, §7](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content) | 16 | Text is generally available under CC BY-SA 4.0. If publishing protected text or an adaptation, credit contributors, link the licence, indicate changes and share adapted text on compatible terms. Check individual page and image notices. This is not a blanket obligation to publish unrelated meal records or independently calculated nutrient values. |

## Decision before replacing data

Only three primary nutrition records are neither FDC nor OFF. When portion weights and densities count, 61 distinct ingredients cite at least one source outside both USDA and OFF. A replacement of only the 29 OFF nutrient profiles does not resolve the eight OFF portion references or establish reuse rights for the other inputs. Prefer FDC, direct package declarations and documented measurements. Keep the source field specific to what was measured, and distinguish independently recorded facts from copied tables, prose and images.
