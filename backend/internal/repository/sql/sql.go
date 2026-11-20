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

// RandomFood selects one existing food ID from the entire catalog.
//
//go:embed catalog/random_food.sql
var RandomFood string

// BootstrapPreflight checks the target database and runtime ownership.
//
//go:embed bootstrap/preflight.sql
var BootstrapPreflight string

// BootstrapRoleFunction defines role setup for one admin session.
//
//go:embed bootstrap/role_function.sql
var BootstrapRoleFunction string

// BootstrapRoles applies both login passwords in one statement.
//
//go:embed bootstrap/roles.sql
var BootstrapRoles string

// CreateDatabase creates the target database under its owner.
//
//go:embed bootstrap/create_database.sql
var CreateDatabase string

// SetDatabaseOwner restores ownership of an existing target database.
//
//go:embed bootstrap/set_database_owner.sql
var SetDatabaseOwner string

// RemovePublicPrivileges restricts database and schema access before migration.
//
//go:embed privileges/remove_public_privileges.sql
var RemovePublicPrivileges string

// RuntimeCatalogRead grants catalog SELECT rights after import.
//
//go:embed privileges/runtime_catalog_read.sql
var RuntimeCatalogRead string

// BootstrapFixtures contains SQL for deployment integration tests.
//
//go:embed testdata/bootstrap/*.sql
var BootstrapFixtures embed.FS
