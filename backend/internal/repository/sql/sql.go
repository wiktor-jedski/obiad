// Package sql embeds the SQL that the Database Setup Module (ARCH-007) and
// the local deployment setup (ARCH-016) apply to PostgreSQL. Migration-runner
// setup SQL lives under setup/, versioned schema migrations under migrations/,
// deployment privilege statements under privileges/, and repository
// persistence SELECTs under catalog/; persistence SQL for the backend
// repository stays colocated
// here and is embedded from Go. SQL statement strings are never placed inline
// in repository Go files.
package sql

import "embed"

// Catalog holds every persistence SELECT for the backend repository
// (ARCH-006). The private concrete PostgreSQL Catalog Loader embeds these
// statements and executes exactly one fresh SELECT per operation; SQL is
// never placed inline in repository Go files.
//
//go:embed catalog/*.sql
var Catalog embed.FS

// Migrations holds every versioned migration file under migrations/. The
// embedded filesystem is passed to the dbsetup migration runner.
//
//go:embed migrations/*.sql
var Migrations embed.FS

// Setup holds SQL used to initialize the migration runner's own database
// metadata before versioned migrations are applied.
//
//go:embed setup/*.sql
var Setup embed.FS

// Privileges holds every deployment privilege file under privileges/. The
// local deployment setup script and the integration fixtures apply these
// files verbatim after substituting their identifier placeholders, so the
// tested SQL is exactly the deployed SQL.
//
//go:embed privileges/*.sql
var Privileges embed.FS
