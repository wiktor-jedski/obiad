# Store localized names in Food Object JSONB

Each Food Object needs one stable identity, mandatory English and Polish names, and room for later language keys. Store its localized names as one constrained JSONB map on the Food Object row. Database checks require nonempty `en` and `pl` string values. Additional language keys are permitted.

Fixed language columns would give simpler checks but require a schema and contract migration for each later language. A separate names table would add joins and a cross-row constraint to guarantee the two mandatory names. The JSONB map keeps the Food Object aggregate local while accepting more complex database checks and JSON extraction.
