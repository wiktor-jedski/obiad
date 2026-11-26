# Ingredient source comparison

Baseline: the 29 ingredient profiles attributed to Open Food Facts (OFF) at data revision `49cc23191c`. Revision `0b2b298cec` replaces those inputs. No other primary ingredient sources are in scope.

Values are grams per 100 g of ingredient, shown as **protein / available carbohydrate / fat**. Display values are rounded to two decimal places where needed. USDA links identify the source food. Where available carbohydrate was not directly reported, use total carbohydrate minus dietary fiber; do not treat missing fiber as zero. If total carbohydrate is zero, available carbohydrate is also zero. Product label values can be rounded. A matching ingredient type is not necessarily the same brand.

## USDA replacements

| Ingredient (ID) | OFF | USDA | USDA record and decision |
| --- | ---: | ---: | --- |
| Rapeseed oil (6) | 0 / 0 / 100 | 0 / 0 / 100 | [FDC 172336](https://fdc.nal.usda.gov/portal-data/external/172336). Generic canola oil. Only the nutrition source changes. |
| Dry spaghetti (124) | 13 / 71 / 2 | 13 / 71.5 / 1.51 | [FDC 168927](https://fdc.nal.usda.gov/portal-data/external/168927). Generic dry unenriched pasta; the record explicitly includes dry spaghetti. |
| Whole-grain mustard (130) | 7.3 / 8.6 / 9.6 | 7.8 / 9.3 / 10.4 | [FDC 438240](https://fdc.nal.usda.gov/portal-data/external/438240). Different brand of whole-grain mustard. [FDC 2403026](https://fdc.nal.usda.gov/portal-data/external/2403026) also supports the existing 5 g teaspoon. |
| Raw ground pork and beef (147) | 19 / 0.5 / 14 | 17.9 / 0 / 18.8 | [FDC 1889175](https://fdc.nal.usda.gov/portal-data/external/1889175). Raw beef and pork only. Blend ratio is unspecified; the USDA product is fattier. Total carbohydrate is zero. |
| Canned pilchards in tomato sauce (3505) | 17 / 4.3 / 5.1 | 16.5 / 3.53 / 2.35 | [FDC 2480819](https://fdc.nal.usda.gov/portal-data/external/2480819). Different brand; [manufacturer](https://crownprince.com/074-075-nutrition-facts.htm) identifies pilchards. Data include tomato sauce, not drained solids. |
| Dry rice noodles (4180) | 7.2 / 82 / 1 | 5.95 / 78.6 / 0.56 | [FDC 169742](https://fdc.nal.usda.gov/portal-data/external/169742). Dry noodles, not cooked. |
| Canned cannellini beans (5030) | 7 / 15.2 / 0.4 | 5.38 / 4.6 / 0.38 | [FDC 2655156](https://fdc.nal.usda.gov/portal-data/external/2655156). Includes canning liquid; not a drained-bean profile. The [manufacturer label](https://shopgalil.com/products/galil-cannellini-beans-white-kidney-beans) confirms the high fiber content. USDA supports the existing 400 g can. |
| Full fat yogurt (5881) | 4 / 5.7 / 3.8 | 3.82 / 5.57 / 4.48 | [FDC 2705418](https://fdc.nal.usda.gov/portal-data/external/2705418). Plain whole-milk yogurt, not Greek or sweetened. |
| Smoked haddock (6055) | 23.5 / 0.1 / 0.3 | 25.2 / 0 / 0.96 | [FDC 174199](https://fdc.nal.usda.gov/portal-data/external/174199). Generic smoked haddock. |
| Plant-based butter (6205) | 0.2 / 1.6 / 75 | 0 / 0 / 78.6 | [FDC 2165439](https://fdc.nal.usda.gov/portal-data/external/2165439). Flora salted plant butter, not the original Lurpak; total carbohydrate is zero. |
| Italian-style fennel pork sausages (6280) | 13.2 / 1.7 / 13 | 18.7 / 0.53 / 11.2 | [FDC 2655021](https://fdc.nal.usda.gov/portal-data/external/2655021). [Raw pork/fennel links](https://www.meatcrafters.com/products/sweet-italian-pork-sausage). Each is 86 g, not 56.25 g. The [rigatoni recipe](https://www.themealdb.com/meal/52783) specifies six links. |
| Clotted cream (6380) | 1.6 / 2.3 / 63.5 | 0 / 3.57 / 64.29 | [FDC 2671751](https://fdc.nal.usda.gov/portal-data/external/2671751). Historical complete label for English clotted cream: zero protein is a rounded label value, not an analytical zero. The [newer record](https://fdc.nal.usda.gov/portal-data/external/2755839) has no carbohydrate value. |
| Dry brown rice noodles (8930) | 4 / 86 / 2 | 7.14 / 73.2 / 1.79 | [FDC 2434837](https://fdc.nal.usda.gov/portal-data/external/2434837). Single-ingredient dry brown rice noodles, different brand. |
| Tomato and garlic pasta sauce (9306) | 1.4 / 7.1 / 0.5 | 1.6 / 8 / 0.8 | [FDC 2030122](https://fdc.nal.usda.gov/portal-data/external/2030122). Representative tomato, garlic and onion sauce. See below for the separate 500 g jar source. |
| Roasted vegetables (9405) | 1.2 / 4.6 / 0.5 | 1.18 / 7.01 / 2.94 | [FDC 2625777](https://fdc.nal.usda.gov/portal-data/external/2625777). Roasted Mediterranean vegetables with added oil and seasoning, not the original unseasoned formulation. Meal 451 retains 400 g. |

## Manufacturer and own-brand replacements

These are figures from the named product label or supplier specification, not a claim that the source website is open-licensed. UK and EU label carbohydrate already excludes fibre. No label prose or images are included in the catalog.

| Ingredient (ID) | Previous OFF | Label | Evidence and match |
| --- | ---: | ---: | --- |
| Wheat flour type 500 (1) | 10 / 74 / 1.2 | 11 / 71 / 0.6 | [Młynpol](https://mlynpol.com.pl/wp-content/uploads/2025/11/mlynpol_02_wroclawska.pdf). Wrocławska wheat flour, same type 500, different mill. |
| Semi-fat twaróg (4) | 16 / 3.8 / 4 | 16 / 3.8 / 4 | [Piątnica](https://piatnica.com.pl/produkt/twarog-poltlusty-4/). Semi-fat twaróg, 4% fat. No change to the profile. |
| Raw gilthead bream (161) | 20.8 / 0.5 / 4.8 | 20.4 / 0.2 / 5.7 | [Kefalonia Fisheries](https://www.kefish.gr/en/kefalonia-taste-and-nutritional-excellence). Annual means for edible gilthead fillet. See the fillet-weight estimate below. |
| Sirop de Liège (503) | 0.7 / 71 / 0.5 | 0.7 / 68 / 0.4 | [Meurens](https://sirop-de-liege.com/produits/sirops-en-pots/bleu-classique/). Classic Liège syrup in a jar; not a flavored syrup. |
| Chilli bean paste (1730) | 7.69 / 15.38 / 0 | 2 / 2.3 / 1.2 | [T.O Foods](https://www.to-foods.com/product/chinese_seasoning/%E5%A4%A9%E5%BA%9C%E8%B1%86%E6%9D%BF%E9%86%A4500g/). Representative chilli and broad-bean paste, not the original Soeos red-oil product. Total carbohydrate 6 minus 3.7 fiber. [YOUKI](https://youki.co.jp/faq/) gives an approximate tablespoon weight for its comparable paste. |
| Cooked sliced döner kebab meat (7481) | 20 / 9.4 / 28 | 15 / 4.8 / 15 | [Görans](https://gorans.fi/en/products/doner-beef-chicken-kebab-slices/). Cooked, sliced beef and chicken döner, different brand and fat content. |
| Dark soy sauce (8405) | 6.1 / 31 / 0.5 | 6.84 / 21.58 / 0 | [Kikkoman India](https://kikkomanindia.com/products/kikkoman-dark-soy-sauce). Sweetened dark soy. The 19 g tablespoon has 1.3 g protein, 4.3 g total carbohydrate, 0.2 g fiber and zero fat. Both the profile and the spoon weight now use this label. |
| Muscovado sugar (8480) | 0 / 98 / 0 | 0.1 / 98.1 / 0.1 | [Wilton](https://wiltonwholefoods.com/2953-wilton-wholefoods-dark-muscovado-sugar-1kg-5060401024062.html). Dark muscovado, different brand. The original CSR label gives limits rather than numbers for fat and protein. |
| Galangal (8555) | 0.5 / 5.9 / 0.5 | 1 / 15 / 0.9 | [Caterite](https://www.caterite.co.uk/fresh-galangal/). Own-brand fresh galangal, not powder. The supplier describes its fresh produce values as approximate. |
| Ras el hanout (8980) | 12 / 46 / 11 | 11.8 / 36.4 / 12.1 | [Zaffaran](https://zaffaran.de/products/ras-el-hanout). Representative spice blend with a different formulation from Ducros. |
| Kabanos sausage (9180) | 19 / 1 / 30 | 19 / 1 / 30 | [Sokołów](https://export.sokolow.com/products/kabanos-and-snacks/kabanos-sausage). Same macros. The 250 g pack and its [photograph of five sticks](https://export.sokolow.com/sites/default/files/styles/max_1920/public/products/kabanosy-export.jpg?itok=Puns8O3C) support a 50 g average, not a guaranteed individual weight. |
| English mustard (9305) | 6.6 / 16 / 10 | 11 / 10 / 17 | [Tracklements](https://www.tracklements.co.uk/product/strong-english-mustard/). Strong prepared English mustard, not powder. Different formulation from Colman’s. |
| Golden caster sugar (9705) | 0 / 100 / 0 | 0 / 99 / 0 | [Wilton](https://wiltonwholefoods.com/3198-wilton-wholefoods-golden-caster-sugar-5kg-5060401026462.html). Unrefined golden caster sugar, different brand. |
| Marinated tofu (9980) | 10.7 / 3.5 / 5 | 9.7 / 3.1 / 4.6 | [Dragonfly](https://dragonflyfoods.com/product/organic-tofu-marinated/). Chilled garlic and ginger marinated tofu, different brand; not a baked or fried product. |

## Portion and release impact

All eight original OFF portion citations now use other evidence. Mustard, beans and muscovado keep their USDA-supported weights. The [San Remo jar](https://sanremo.com.au/products/pasta-sauce-tomato-onion-garlic/) supports 500 g for tomato and garlic sauce, without changing its USDA macros. Sokołów supports a 50 g average per kabanos. Three portion weights changed:

- Fennel pork sausage: 56.25 → 86 g/link (USDA). Six links in meal 326: 337.5 → 516 g; summed yield: 1,952.13 → 2,130.63 g.
- Chilli bean paste: 13 → approximately 18 g/tbsp (YOUKI). The 1½ tablespoons in meal 147 now weigh 27 g instead of 19.5 g; summed yield: 890.836667 → 898.336667 g.
- Gilthead bream: 366 → 270 g edible fillet per medium fish. For nutrition, use the midpoint of [Cromaris’s 115–155 g pin-bone-out fillet grade](https://cromaris.com/en/product/cromaris-seabream/): 135 g per fillet, two fillets per fish. This is a catalog estimate, not a measured yield. The [baked bream recipe](https://kuchnia-domowa.pl/dania-glowne/532-pieczona-dorada) still cooks two gutted fish. Four fillets contribute 540 g; with 30.5 g of lemon juice, the summed input yield is 570.5 g.

The Kikkoman label also replaces the generic USDA shoyu spoon proxy (16 → 19 g/tbsp). Two tablespoons in meal 411 now weigh 38 g instead of 32 g; half a tablespoon in meal 460 weighs 9.5 g instead of 8 g. Their summed yields increase by 6 g and 1.5 g respectively.

No ingredient nutrition or portion field in this revision cites OFF.
