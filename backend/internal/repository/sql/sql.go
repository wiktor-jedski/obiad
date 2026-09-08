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

// LockCatalog serializes offline catalog replacement with migrations.
//
//go:embed catalog/lock_catalog.sql
var LockCatalog string

// ClearCatalog removes both parts of the previous snapshot.
//
//go:embed catalog/clear_catalog.sql
var ClearCatalog string

// InsertFamily stores one validated Food Family.
//
//go:embed catalog/insert_family.sql
var InsertFamily string

// InsertFoodObject stores one validated Food Object.
//
//go:embed catalog/insert_food_object.sql
var InsertFoodObject string
