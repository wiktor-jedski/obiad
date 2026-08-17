// Package sql embeds the versioned SQL migrations that the Database Setup
// Module (ARCH-007) applies to PostgreSQL. Persistence SQL for the backend
// repository lives under this directory and is embedded from Go; SQL statement
// strings are never placed inline in repository Go files.
package sql

import "embed"

// Migrations holds every versioned migration file under migrations/. The
// embedded filesystem is passed to the dbsetup migration runner.
//
//go:embed migrations/*.sql
var Migrations embed.FS
