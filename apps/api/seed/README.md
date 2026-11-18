# Seed data

`sample-register.csv` is **fictional development data**: one LGA (code `24-99`, which does not exist in INEC's register) with 3 wards and 30 polling units. Every name starts with `SAMPLE`. Never load it into production.

Import it with:

```sh
npm run register:import -w @trustelect/api -- apps/api/seed/sample-register.csv
```

The real register uses the same columns: `pu_code, pu_name, ward_name, lga_name, state_name`, optionally `latitude, longitude, registered_voters`.
