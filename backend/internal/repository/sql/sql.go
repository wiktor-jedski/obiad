// Package sql embeds SQL files used by the backend.
package sql

import "embed"

// Catalog contains repository SELECT statements.
//
//go:embed catalog/*.sql
var Catalog embed.FS

// Migrations contains versioned migration files.
//
//go:embed migrations/*.sql
var Migrations embed.FS

// Setup contains migration metadata SQL.
//
//go:embed setup/*.sql
var Setup embed.FS

// Privileges contains deployment privilege SQL.
//
//go:embed privileges/*.sql
var Privileges embed.FS
